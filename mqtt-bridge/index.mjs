import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";

import { boxTopic, mqttCommandSchema, mqttDefaults, mqttSettingsSchema } from "../src/lib/mqtt.ts";
import { createBrokerClient, resolveBroker } from "./broker.mjs";

const { MQTT_BRIDGE_TOKEN: token, MQTT_APP_URL: appUrl } = process.env;
if (!token || !appUrl) throw new Error("MQTT_BRIDGE_TOKEN and MQTT_APP_URL are required");
const app = new URL(appUrl);
const privateHosts = new Set(
  (process.env.MQTT_PRIVATE_BROKERS ?? "")
    .toLowerCase()
    .split(",")
    .map((host) => host.trim()),
);
const credentialSchema = z.record(
  z.object({ username: z.string().min(1), password: z.string().optional() }),
);
let brokerCredentials;
try {
  brokerCredentials = credentialSchema.parse(
    JSON.parse(process.env.MQTT_BROKER_CREDENTIALS ?? "{}"),
  );
} catch {
  throw new Error("Invalid MQTT_BROKER_CREDENTIALS configuration");
}
const digest = (value) => createHash("sha256").update(value).digest();
const tokenDigest = digest(`Bearer ${token}`);
const database = new DatabaseSync(process.env.MQTT_BRIDGE_DB ?? "mqtt-bridge.local");
database.exec(`
  CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, settings TEXT NOT NULL, enabled INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS published (
    device_id TEXT NOT NULL, local_date TEXT NOT NULL, schedule_id TEXT NOT NULL,
    PRIMARY KEY (device_id, local_date, schedule_id)
  );
`);
const load = database.prepare("SELECT settings, enabled FROM connections WHERE id = ?");
const save = database.prepare(`
  INSERT INTO connections VALUES (?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET settings = excluded.settings, enabled = excluded.enabled
`);
const findPublished = database.prepare(
  "SELECT 1 FROM published WHERE device_id = ? AND local_date = ? AND schedule_id = ?",
);
const markPublished = database.prepare("INSERT OR IGNORE INTO published VALUES (?, ?, ?)");
const sessions = new Map();

function callApp(path, id, body, key) {
  const url = new URL(`/api/internal/mqtt/${path}`, app);
  url.searchParams.set("deviceId", id);
  const headers = { Authorization: `Bearer ${token}` };
  if (key) {
    headers["Content-Type"] = "application/json";
    headers["X-Device-Key"] = key;
  }
  return fetch(url, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000),
    redirect: "error",
  });
}

const deviceKey = z.string().regex(/^smrb_[0-9a-f]{48}$/);
const messageSchema = z.union([
  z.object({ device_key: deviceKey, status: z.record(z.unknown()) }).strict(),
  z
    .object({
      device_key: deviceKey,
      schedule_id: z.string().uuid(),
      scheduled_date: z.string().date(),
    })
    .strict(),
]);

async function forwardSensorMessage(session, packet) {
  if (packet.topic !== session.sensorTopic || packet.retain || packet.payload.length > 8192) return;
  let message;
  try {
    const result = messageSchema.safeParse(JSON.parse(packet.payload.toString("utf8")));
    if (!result.success) return;
    message = result.data;
  } catch {
    return;
  }

  const response =
    "status" in message
      ? await callApp("status", session.id, message.status, message.device_key)
      : await callApp(
          "confirm",
          session.id,
          { schedule_id: message.schedule_id, scheduled_date: message.scheduled_date },
          message.device_key,
        );
  await response.body?.cancel();
  if (response.status >= 500) throw new Error("Sensor callback failed");
}

function retry(session, client) {
  if (sessions.get(session.id) !== session || session.retry || session.client !== client) return;
  session.state = "disconnected";
  session.failed = true;
  session.client = null;
  session.addressAttempt += 1;
  clearTimeout(session.subscribeTimeout);
  client?.end(true);
  session.retry = setTimeout(() => {
    session.retry = null;
    void openBroker(session);
  }, 10000);
}

async function openBroker(session) {
  session.state = "connecting";
  session.failed = false;
  let client = null;
  try {
    const address = await resolveBroker(
      session.settings.host,
      privateHosts,
      session.addressAttempt,
    );
    if (sessions.get(session.id) !== session) return;
    const { host, transport, ports } = session.settings;
    const endpoint = `${transport}://${host}:${ports[transport]}`;
    const credentials = Object.hasOwn(brokerCredentials, endpoint)
      ? brokerCredentials[endpoint]
      : undefined;
    client = createBrokerClient(session.settings, address, `carebee-${session.id}`, credentials);
    session.client = client;
    client.on("error", () => retry(session, client));
    client.on("close", () => retry(session, client));
    client.handleMessage = (packet, callback) => {
      if (sessions.get(session.id) !== session || session.client !== client) return callback();
      void forwardSensorMessage(session, packet).then(
        () => callback(),
        () => retry(session, client),
      );
    };
    client.once("connect", async () => {
      const timeout = setTimeout(() => retry(session, client), 8000);
      session.subscribeTimeout = timeout;
      try {
        const [grant] = await client.subscribeAsync(session.sensorTopic, { qos: 1 });
        if (!grant || grant.qos > 2) throw new Error("Broker refused the sensor topic");
        if (sessions.get(session.id) === session && session.client === client) {
          session.state = "connected";
          void publishDue(session);
        }
      } catch {
        retry(session, client);
      } finally {
        clearTimeout(timeout);
      }
    });
    client.connect();
  } catch {
    retry(session, client);
  }
}

function start(id, settings) {
  const session = {
    addressAttempt: 0,
    id,
    settings,
    state: "connecting",
    failed: false,
    retry: null,
    client: null,
    polling: false,
    sensorTopic: boxTopic(settings.sensorTopic, id),
    scheduleTopic: boxTopic(settings.scheduleTopic, id),
  };
  sessions.set(id, session);
  void openBroker(session);
}

function stop(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  clearTimeout(session.retry);
  clearTimeout(session.subscribeTimeout);
  session.client?.end(true);
}

async function publishDue(session) {
  const client = session.client;
  if (!client || session.state !== "connected" || session.polling) return;
  session.polling = true;
  try {
    const response = await callApp("due", session.id);
    if (sessions.get(session.id) !== session) return;
    if (response.status === 404) {
      stop(session.id);
      database.prepare("DELETE FROM connections WHERE id = ?").run(session.id);
      return;
    }
    if (!response.ok) return;
    const schedule = await response.json();
    for (const dose of schedule.doses) {
      if (session.client !== client || sessions.get(session.id) !== session || !client.connected)
        break;
      if (Math.floor(Date.now() / 60000) !== Math.floor(Date.parse(schedule.at) / 60000)) break;
      if (session.settings.medicineIds && !session.settings.medicineIds.includes(dose.medicine_id))
        continue;
      if (findPublished.get(session.id, schedule.date, dose.schedule_id)) continue;
      const payload =
        session.settings.payload ||
        JSON.stringify({
          type: "medication_due",
          notification_id: `${session.id}:${schedule.date}:${dose.schedule_id}`,
          box_id: session.id,
          date: schedule.date,
          timezone: schedule.timezone,
          ...dose,
        });
      const published = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          retry(session, client);
          resolve(false);
        }, 8000);
        client.publish(session.scheduleTopic, payload, { qos: 1, retain: false }, (error) => {
          clearTimeout(timeout);
          resolve(!error);
        });
      });
      if (!published) break;
      markPublished.run(session.id, schedule.date, dose.schedule_id);
    }
  } catch {
    // Unacknowledged reminders are eligible for retry during the same scheduled minute.
  } finally {
    session.polling = false;
  }
}

function snapshot(id) {
  const row = load.get(id);
  const session = sessions.get(id);
  return {
    settings: row ? JSON.parse(row.settings) : mqttDefaults,
    enabled: Boolean(row?.enabled),
    state: session?.state ?? "disconnected",
    failed: session?.failed ?? false,
  };
}

async function handleRequest(request, response) {
  if (request.method !== "POST" || request.url !== "/connections")
    return response.writeHead(404).end();
  if (!timingSafeEqual(digest(request.headers.authorization ?? ""), tokenDigest))
    return response.writeHead(401).end();

  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > 32768) return response.writeHead(413).end();
  }
  let result;
  try {
    result = mqttCommandSchema.safeParse(JSON.parse(body));
  } catch {
    return response.writeHead(400).end();
  }
  if (!result.success) return response.writeHead(400).end();
  const { action, deviceId } = result.data;
  if (action === "connect") {
    if (sessions.has(deviceId)) return response.writeHead(409).end();
    save.run(deviceId, JSON.stringify(result.data.settings), 1);
    start(deviceId, result.data.settings);
  }
  if (action === "disconnect") {
    database.prepare("UPDATE connections SET enabled = 0 WHERE id = ?").run(deviceId);
    stop(deviceId);
  }
  return response
    .writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    .end(JSON.stringify(snapshot(deviceId)));
}

for (const row of database
  .prepare("SELECT id, settings FROM connections WHERE enabled = 1")
  .all()) {
  start(row.id, mqttSettingsSchema.parse(JSON.parse(row.settings)));
}
setInterval(() => sessions.forEach((session) => void publishDue(session)), 5000);
setInterval(() => {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  database.prepare("DELETE FROM published WHERE local_date < ?").run(cutoff);
}, 86400000);

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => response.writeHead(500).end());
});
server.listen(Number(process.env.PORT ?? 8789), process.env.MQTT_BRIDGE_BIND ?? "127.0.0.1", () => {
  console.log("CareBee MQTT bridge is listening");
});
