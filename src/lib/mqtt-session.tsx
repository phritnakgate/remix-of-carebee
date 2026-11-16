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

const openMqtt = createClientOnlyFn(async (settings: MqttSettings) => {
  const { default: mqtt } = await import("mqtt");
  return mqtt.connect(`wss://${settings.host}:${settings.websocketPort}${settings.websocketPath}`, {
    manualConnect: true,
    connectTimeout: 8000,
    reconnectPeriod: 0,
    keepalive: 30,
    forceNativeWebSocket: true,
  });
});

const storageKey = (deviceId: string) => `carebee-mqtt:${deviceId}`;

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
}

interface SessionContext {
  connections: Partial<Record<string, MqttConnection>>;
  traffic: Partial<Record<string, MqttTraffic>>;
  clearTraffic: (deviceId: string) => void;
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
  const [traffic, setTraffic] = useState<SessionContext["traffic"]>({});
  const nextMessageId = useRef(0);
  const sessions = useRef(new Map<string, Session>());
  const restored = useRef(new Set<string>());
  const devices = useDevices(userId).data;
  const getDue = useServerFn(getMqttDue);
  const forward = useServerFn(forwardMqttSensor);

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
    };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", checkAll);
    window.addEventListener("focus", checkAll);
    document.addEventListener("visibilitychange", checkAll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", checkAll);
      window.removeEventListener("focus", checkAll);
      document.removeEventListener("visibilitychange", checkAll);
      closeAll();
    };
  }, []);

  const recordTraffic = useCallback(
    (
      deviceId: string,
      direction: MqttDirection,
      topic: string,
      payload: string,
      state: MqttMessageState,
    ) => {
      const message = {
        id: ++nextMessageId.current,
        at: Date.now(),
        topic,
        payload: mqttPayloadPreview(payload),
        state,
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

  const disconnect = useCallback((deviceId: string) => {
    const saved = readSavedConnection(deviceId);
    if (saved) saveConnection(deviceId, saved.settings, false);
    sessions.current.get(deviceId)?.close();
    sessions.current.delete(deviceId);
    setConnections((previous) => ({ ...previous, [deviceId]: undefined }));
  }, []);

  const connect = useCallback(
    (deviceId: string, settings: MqttSettings) => {
      if (sessions.current.has(deviceId)) return;
      saveConnection(deviceId, settings, true);

      const sensorTopic = boxTopic(settings.sensorTopic, deviceId);
      const scheduleTopic = boxTopic(settings.scheduleTopic, deviceId);
      let client: MqttClient | null = null;
      let retryTimer: number | undefined;
      let subscribeTimer: number | undefined;
      let active = true;
      let ready = false;
      let checking = false;
      let sentDate = "";
      const sent = new Set<string>();

      function setState(state: MqttConnection["state"], failed = false) {
        setConnections((previous) => ({ ...previous, [deviceId]: { settings, state, failed } }));
      }

      function releaseClient() {
        ready = false;
        window.clearTimeout(subscribeTimer);
        const closing = client;
        client = null;
        closing?.end(true);
      }

      function retry() {
        if (!active || retryTimer !== undefined) return;
        setState("disconnected", true);
        retryTimer = window.setTimeout(() => {
          retryTimer = undefined;
          void open();
        }, 10000);
        releaseClient();
      }

      async function checkDue() {
        const connected = client;
        if (!ready || !connected?.connected || checking || !active) return;
        checking = true;
        try {
          const due = await getDue({ data: { deviceId } });
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
            if (settings.medicineIds && !settings.medicineIds.includes(dose.medicine_id)) continue;
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
              const payload =
                settings.payload ||
                JSON.stringify({
                  type: "medication_due",
                  notification_id: notificationId,
                  box_id: deviceId,
                  date: due.date,
                  timezone: due.timezone,
                  ...dose,
                });
              const markSent = recordTraffic(
                deviceId,
                "outgoing",
                scheduleTopic,
                payload,
                "sending",
              );
              const acknowledged = await new Promise<boolean>((resolve) => {
                const timeout = window.setTimeout(() => {
                  if (client === connected) retry();
                  resolve(false);
                }, 7000);
                const finish = (success: boolean) => {
                  window.clearTimeout(timeout);
                  resolve(success);
                };
                try {
                  connected.publish(scheduleTopic, payload, { qos: 1, retain: false }, (error) =>
                    finish(!error),
                  );
                } catch {
                  finish(false);
                }
              });
              markSent(acknowledged ? "acknowledged" : "sendFailed");
              if (!acknowledged) return;
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
          const socket = await openMqtt(settings);
          if (!active) {
            socket.end(true);
            return;
          }
          if (client) releaseClient();
          client = socket;
          socket.on("error", () => {
            if (client === socket) retry();
          });
          socket.on("close", () => {
            if (client === socket) retry();
          });
          socket.handleMessage = (packet, done) => {
            if (client !== socket || packet.topic !== sensorTopic) {
              done();
              return;
            }
            const oversize = packet.payload.length > 8192;
            const message = packet.payload.toString("utf8", 0, 8192);
            const markReceived = recordTraffic(
              deviceId,
              "incoming",
              sensorTopic,
              message,
              packet.retain ? "retained" : oversize ? "oversize" : "received",
            );
            if (packet.retain || oversize) {
              done();
              return;
            }
            void forward({ data: { deviceId, message } })
              .then(
                (accepted) => markReceived(accepted ? "processed" : "notProcessed"),
                () => markReceived("notProcessed"),
              )
              .finally(done);
          };
          socket.once("connect", () => {
            subscribeTimer = window.setTimeout(() => {
              if (client === socket) retry();
            }, 8000);
            socket.subscribe(sensorTopic, { qos: 1 }, (error, grants) => {
              if (client !== socket) return;
              window.clearTimeout(subscribeTimer);
              if (error || !grants?.[0] || grants[0].qos > 2) {
                retry();
                return;
              }
              ready = true;
              setState("connected");
              void checkDue();
            });
          });
          socket.connect();
        } catch {
          retry();
        }
      }

      sessions.current.set(deviceId, {
        checkDue,
        close: () => {
          active = false;
          window.clearTimeout(retryTimer);
          releaseClient();
        },
      });
      void open();
    },
    [disconnect, forward, getDue, recordTraffic],
  );

  useEffect(() => {
    const seen = restored.current;
    const restore = () => {
      for (const device of devices ?? []) {
        if (device.mode !== "real" || seen.has(device.id)) continue;
        seen.add(device.id);
        const saved = readSavedConnection(device.id);
        if (saved?.enabled) connect(device.id, saved.settings);
      }
    };
    restore();
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, [connect, devices]);

  return (
    <Context.Provider value={{ connections, traffic, clearTraffic, connect, disconnect }}>
      {children}
    </Context.Provider>
  );
}
