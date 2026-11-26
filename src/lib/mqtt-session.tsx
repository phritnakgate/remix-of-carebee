import { useQueryClient } from "@tanstack/react-query";
import { createClientOnlyFn, useServerFn } from "@tanstack/react-start";
import type { MqttClient } from "mqtt";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  boxTopic,
  isMqttTestMessage,
  mqttBrokerUrl,
  mqttPayloadLimit,
  mqttPayloadPreview,
  mqttSettingsSchema,
  type MqttConnection,
  type MqttDirection,
  type MqttMessageState,
  type MqttSettings,
  type MqttTraffic,
} from "./mqtt";
import { forwardMqttSensor, getMqttDue } from "./mqtt.functions";
import { useDevices } from "./queries";
import { readReminderTemplate, scheduledReminderPayload } from "./reminder-template";
import { getRtcSchedule } from "./rtc.functions";
import { partialIntakeSchema, rtcMqttPayload } from "./rtc";

const openMqtt = createClientOnlyFn(
  async (settings: MqttSettings, onTransport: (socket: WebSocket) => void) => {
    const { default: mqtt } = await import("mqtt");
    return mqtt.connect(mqttBrokerUrl(settings), {
      manualConnect: true,
      connectTimeout: 8000,
      reconnectPeriod: 0,
      keepalive: 30,
      forceNativeWebSocket: true,
      createWebsocket(url, protocols) {
        const socket = new WebSocket(url, protocols);
        onTransport(socket);
        return socket;
      },
    });
  },
);

const storagePrefix = "carebee-mqtt:";
const storageKey = (deviceId: string) => `${storagePrefix}${deviceId}`;

function readSavedConnection(deviceId: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(deviceId)) ?? "null");
    const result = mqttSettingsSchema.safeParse(saved?.settings);
    if (result.success) return { settings: result.data, enabled: saved.enabled === true };
  } catch {
    // The connection still works when browser storage is unavailable.
  }
  return undefined;
}

export function readMqttSettings(deviceId: string) {
  return readSavedConnection(deviceId)?.settings;
}

function saveConnection(deviceId: string, settings: MqttSettings, enabled: boolean) {
  try {
    localStorage.setItem(storageKey(deviceId), JSON.stringify({ settings, enabled }));
  } catch {
    // Settings can still be used for this open tab.
  }
}

interface Session {
  close: () => void;
  checkDue: () => Promise<void>;
  publishTest: (payload: string) => Promise<boolean>;
}

interface SessionContext {
  connections: Partial<Record<string, MqttConnection>>;
  testContacts: Partial<Record<string, true>>;
  traffic: Partial<Record<string, MqttTraffic>>;
  clearTraffic: (deviceId: string) => void;
  publishTest: (deviceId: string, payload: string) => Promise<boolean>;
  connect: (deviceId: string, settings: MqttSettings) => void;
  disconnect: (deviceId: string) => void;
}

const Context = createContext<SessionContext | null>(null);
const emptyTraffic: MqttTraffic = { incoming: [], outgoing: [] };
const historyLimit = 30;

export function useMqttSession() {
  const value = useContext(Context);
  if (!value) throw new Error("useMqttSession requires MqttSessionProvider");
  return value;
}

export function MqttSessionProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [connections, setConnections] = useState<SessionContext["connections"]>({});
  const [testContacts, setTestContacts] = useState<SessionContext["testContacts"]>({});
  const [traffic, setTraffic] = useState<SessionContext["traffic"]>({});
  const nextMessageId = useRef(0);
  const sessions = useRef(new Map<string, Session>());
  const restored = useRef(new Set<string>());
  const devices = useDevices(userId).data;
  const queryClient = useQueryClient();
  const getDue = useServerFn(getMqttDue);
  const getRtc = useServerFn(getRtcSchedule);
  const forward = useServerFn(forwardMqttSensor);

  const stopSession = useCallback((deviceId: string) => {
    const session = sessions.current.get(deviceId);
    sessions.current.delete(deviceId);
    setConnections((previous) => ({ ...previous, [deviceId]: undefined }));
    session?.close();
  }, []);

  useEffect(() => {
    const active = sessions.current;
    const seen = restored.current;
    const checkAll = () => active.forEach((session) => void session.checkDue());
    const timer = window.setInterval(checkAll, 5000);
    const closeAll = () => {
      active.forEach((session) => session.close());
      active.clear();
      seen.clear();
    };
    const pageHide = () => {
      closeAll();
      setConnections({});
      setTraffic({});
      setTestContacts({});
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith(storagePrefix)) return;
      const deviceId = event.key.slice(storagePrefix.length);
      if (active.has(deviceId) && !readSavedConnection(deviceId)?.enabled) stopSession(deviceId);
    };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", checkAll);
    window.addEventListener("focus", checkAll);
    window.addEventListener("carebee-schedule-changed", checkAll);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", checkAll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", checkAll);
      window.removeEventListener("focus", checkAll);
      window.removeEventListener("carebee-schedule-changed", checkAll);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", checkAll);
      closeAll();
    };
  }, [stopSession]);

  const recordTraffic = useCallback(
    (
      deviceId: string,
      direction: MqttDirection,
      topic: string,
      payload: string,
      state: MqttMessageState,
      test = false,
    ) => {
      const message = {
        id: ++nextMessageId.current,
        at: Date.now(),
        topic,
        payload: mqttPayloadPreview(payload),
        state,
        test,
      };
      setTraffic((previous) => {
        const box = previous[deviceId] ?? emptyTraffic;
        return {
          ...previous,
          [deviceId]: { ...box, [direction]: [message, ...box[direction]].slice(0, historyLimit) },
        };
      });

      return (state: MqttMessageState) =>
        setTraffic((previous) => {
          const box = previous[deviceId];
          if (!box?.[direction].some((entry) => entry.id === message.id)) return previous;
          return {
            ...previous,
            [deviceId]: {
              ...box,
              [direction]: box[direction].map((entry) =>
                entry.id === message.id ? { ...entry, state } : entry,
              ),
            },
          };
        });
    },
    [],
  );

  function clearTraffic(deviceId: string) {
    setTraffic((previous) => ({ ...previous, [deviceId]: undefined }));
  }

  async function publishTest(deviceId: string, payload: string) {
    if (!payload.trim() || payload.length > mqttPayloadLimit) return false;
    return (await sessions.current.get(deviceId)?.publishTest(payload)) ?? false;
  }

  const disconnect = useCallback(
    (deviceId: string) => {
      const saved = readSavedConnection(deviceId);
      if (saved) saveConnection(deviceId, saved.settings, false);
      stopSession(deviceId);
    },
    [stopSession],
  );

  const connect = useCallback(
    (deviceId: string, settings: MqttSettings) => {
      if (sessions.current.has(deviceId)) return;
      saveConnection(deviceId, settings, true);

      const sensorTopic = boxTopic(settings.sensorTopic, deviceId);
      const scheduleTopic = boxTopic(settings.scheduleTopic, deviceId);
      let client: MqttClient | null = null;
      let transport: WebSocket | null = null;
      let started = false;
      let subscribeTimer: number | undefined;
      let active = true;
      let ready = false;
      let checking = false;
      let sentDate = "";
      let rtcSnapshot = "";
      const sent = new Set<string>();
      const pendingPublishes = new Set<() => void>();
      const requests = new AbortController();
      let incoming = Promise.resolve();
      let queuedReports = 0;

      function setState(state: MqttConnection["state"], failed = false) {
        setConnections((previous) => ({ ...previous, [deviceId]: { settings, state, failed } }));
      }

      function releaseClient() {
        ready = false;
        window.clearTimeout(subscribeTimer);
        const closing = client;
        const socket = transport;
        client = null;
        transport = null;
        pendingPublishes.forEach((cancel) => cancel());
        try {
          if (started) closing?.end(true);
        } catch {
          // MQTT.js can throw if its stream was never created. Close the transport directly.
        } finally {
          if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
        }
      }

      function connectionFailed() {
        if (!active) return;
        disconnect(deviceId);
        setState("disconnected", true);
      }

      async function publishMessage(payload: string, test: boolean) {
        const socket = client;
        if (!active || !ready || !socket?.connected) return false;
        const update = recordTraffic(deviceId, "outgoing", scheduleTopic, payload, "sending", test);
        const acknowledged = await new Promise<boolean>((resolve) => {
          const timeout = window.setTimeout(() => {
            finish(false);
            if (client === socket) connectionFailed();
          }, 7000);
          const finish = (success: boolean) => {
            window.clearTimeout(timeout);
            pendingPublishes.delete(cancel);
            resolve(success);
          };
          const cancel = () => finish(false);
          pendingPublishes.add(cancel);
          try {
            socket.publish(scheduleTopic, payload, { qos: 1, retain: false }, (error) =>
              finish(!error),
            );
          } catch {
            finish(false);
          }
        });
        update(acknowledged ? "acknowledged" : "sendFailed");
        return acknowledged;
      }

      async function checkDue() {
        const connected = client;
        if (!ready || !connected?.connected || checking || !active) return;
        checking = true;
        try {
          if (settings.rtc) {
            const config = await getRtc({ data: { deviceId }, signal: requests.signal });
            if (!active) return;
            const snapshot = JSON.stringify(config.channels);
            if (snapshot === rtcSnapshot) return;
            for (const channel of config.channels) {
              if (!(await publishMessage(JSON.stringify(rtcMqttPayload(channel, settings.compartmentWeightsG?.[channel.compartment - 1])), false))) return;
            }
            rtcSnapshot = snapshot;
            return;
          }
          const due = await getDue({ data: { deviceId }, signal: requests.signal });
          if (!active) return;
          if (!due) {
            disconnect(deviceId);
            return;
          }
          if (sentDate !== due.date) {
            sent.clear();
            sentDate = due.date;
          }

          for (const dose of due.doses) {
            if (
              !dose.device_id &&
              settings.medicineIds &&
              !settings.medicineIds.includes(dose.medicine_id)
            )
              continue;
            if (sent.has(dose.schedule_id)) continue;
            const notificationId = `${deviceId}:${due.date}:${dose.schedule_id}`;
            const publish = async () => {
              if (
                !active ||
                client !== connected ||
                !connected.connected ||
                Date.now() >= (due.minute + 1) * 60000
              )
                return;
              // A second open tab may already have published this dose.
              const key = `${storageKey(deviceId)}:last-date:${dose.schedule_id}`;
              try {
                if (localStorage.getItem(key) === due.date) {
                  sent.add(dose.schedule_id);
                  return;
                }
              } catch {
                // Fall back to this tab's acknowledgement history.
              }
              const message = {
                type: "medication_due",
                notification_id: notificationId,
                box_id: deviceId,
                date: due.date,
                timezone: due.timezone,
                ...dose,
              };
              const payload = scheduledReminderPayload(
                message,
                due.reminderTemplate ?? "",
                readReminderTemplate(deviceId),
                settings.payload,
              );
              if (!(await publishMessage(payload, false))) return;
              sent.add(dose.schedule_id);
              try {
                localStorage.setItem(key, due.date);
              } catch {
                // The in-memory acknowledgement still prevents repeats in this tab.
              }
            };
            if (navigator.locks) await navigator.locks.request(notificationId, publish);
            else await publish();
          }
        } catch {
          // The next timer tick retries while the scheduled minute is still current.
        } finally {
          checking = false;
        }
      }

      async function open() {
        setState("connecting");
        try {
          const socket = await openMqtt(settings, (nativeSocket) => {
            transport = nativeSocket;
          });
          if (!active) return;
          client = socket;
          socket.on("error", () => {
            if (client === socket) connectionFailed();
          });
          socket.on("close", () => {
            if (client === socket) connectionFailed();
          });
          socket.on("message", (topic, payload, packet) => {
            if (client !== socket || topic !== sensorTopic) return;
            const oversize = payload.length > 8192;
            const message = payload.toString("utf8", 0, 8192);
            const test = !oversize && isMqttTestMessage(message);
            const queueFull = queuedReports >= 32;
            const markReceived = recordTraffic(
              deviceId,
              "incoming",
              sensorTopic,
              message,
              packet.retain
                ? "retained"
                : oversize
                  ? "oversize"
                  : queueFull && !test
                    ? "notProcessed"
                    : "received",
              test,
            );
            if (packet.retain || oversize) return;
            try {
              const request = JSON.parse(message);
              if (settings.rtc && request.type === "schedule_request" && request.deviceId === deviceId) {
                rtcSnapshot = "";
                void checkDue();
                return;
              }
            } catch {
              // The traffic viewer also supports plain-text PoC messages.
            }
            if (test) {
              setTestContacts((previous) =>
                previous[deviceId] ? previous : { ...previous, [deviceId]: true },
              );
              return;
            }
            if (queueFull) return;
            queuedReports += 1;
            // Preserve sensor ordering without holding up MQTT acknowledgements or keepalives.
            incoming = incoming.then(async () => {
              try {
                if (requests.signal.aborted) {
                  markReceived("notProcessed");
                  return;
                }
                const signal = AbortSignal.any([requests.signal, AbortSignal.timeout(8000)]);
                const accepted = await forward({ data: { deviceId, message }, signal });
                markReceived(accepted ? "processed" : "notProcessed");
                if (accepted) {
                  void queryClient.invalidateQueries({ queryKey: ["devices", userId] });
                  void queryClient.invalidateQueries({ queryKey: ["device_events", userId] });
                  void queryClient.invalidateQueries({ queryKey: ["dose_logs"] });
                  void queryClient.invalidateQueries({ queryKey: ["medicines"] });
                  if (settings.rtc) {
                    try {
                      const report = JSON.parse(message);
                      const partial = partialIntakeSchema.safeParse(report);
                      if (partial.success) void queryClient.invalidateQueries({ queryKey: ["device_events", "partial"] });
                      if (report.deviceId === deviceId && (report.isTake === true || partial.success)) {
                        await publishMessage(JSON.stringify({
                          type: "intake_ack", compartment: report.compartment,
                          ...(partial.success ? { outcome: "partial" } : {}),
                          ...(report.scheduledDate ? { scheduledDate: report.scheduledDate } : {}),
                        }), false);
                      }
                    } catch {
                      // Non-JSON traffic does not have an application acknowledgement.
                    }
                  }
                }
              } catch {
                markReceived("notProcessed");
              } finally {
                queuedReports -= 1;
              }
            });
          });
          socket.once("connect", () => {
            subscribeTimer = window.setTimeout(() => {
              if (client === socket) connectionFailed();
            }, 8000);
            socket.subscribe(sensorTopic, { qos: 1 }, (error, grants) => {
              if (client !== socket) return;
              window.clearTimeout(subscribeTimer);
              if (error || !grants?.[0] || grants[0].qos > 2) {
                connectionFailed();
                return;
              }
              ready = true;
              setState("connected");
              void checkDue();
            });
          });
          socket.connect();
          started = true;
        } catch {
          connectionFailed();
        }
      }

      sessions.current.set(deviceId, {
        checkDue,
        publishTest: (payload) => publishMessage(payload, true),
        close: () => {
          active = false;
          requests.abort();
          releaseClient();
        },
      });
      void open();
    },
    [disconnect, forward, getDue, getRtc, queryClient, recordTraffic, userId],
  );

  useEffect(() => {
    const seen = restored.current;
    const restore = () => {
      for (const device of devices ?? []) {
        if (device.mode !== "real" || seen.has(device.id)) continue;
        seen.add(device.id);
        const saved = readSavedConnection(device.id);
        if (saved?.enabled) connect(device.id, { ...saved.settings, rtc: true });
      }
    };
    restore();
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [connect, devices]);

  return (
    <Context.Provider
      value={{ connections, testContacts, traffic, clearTraffic, publishTest, connect, disconnect }}
    >
      {children}
    </Context.Provider>
  );
}
