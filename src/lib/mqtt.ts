import { z } from "zod";

const port = z.number().int().min(1).max(65535);
const topic = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // MQTT topic names cannot contain NUL, and exact subscriptions cannot contain wildcards.
  // eslint-disable-next-line no-control-regex
  .regex(/^[^#+\x00-\x20]+$/)
  .refine((value) => !value.endsWith("/"));

export const mqttSettingsSchema = z
  .object({
    host: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
    websocketPort: port,
    websocketPath: z
      .string()
      .trim()
      .max(200)
      .regex(/^\/(?!\/)[A-Za-z0-9/_\-.%]*$/),
    sensorTopic: topic,
    scheduleTopic: topic,
    payload: z.string().max(4096),
    medicineIds: z.array(z.string().uuid()).max(500).nullable().default(null),
  })
  .refine((settings) => settings.sensorTopic !== settings.scheduleTopic, {
    path: ["scheduleTopic"],
  });

export type MqttSettings = z.infer<typeof mqttSettingsSchema>;
export type MqttState = "disconnected" | "connecting" | "connected";

const deviceKey = z.string().regex(/^smrb_[0-9a-f]{48}$/);
export const mqttSensorSchema = z.union([
  z.object({ device_key: deviceKey, status: z.record(z.unknown()) }).strict(),
  z
    .object({
      device_key: deviceKey,
      schedule_id: z.string().uuid(),
      scheduled_date: z.string().date(),
    })
    .strict(),
]);

export interface MqttConnection {
  settings: MqttSettings;
  state: MqttState;
  failed: boolean;
}

export type MqttDirection = "incoming" | "outgoing";
export type MqttMessageState =
  | "received"
  | "processed"
  | "notProcessed"
  | "retained"
  | "oversize"
  | "sending"
  | "acknowledged"
  | "sendFailed";

export interface MqttMessage {
  id: number;
  at: number;
  topic: string;
  payload: string;
  state: MqttMessageState;
}

export type MqttTraffic = Record<MqttDirection, MqttMessage[]>;

export function mqttPayloadPreview(message: string) {
  let preview = message;
  try {
    preview = JSON.stringify(
      JSON.parse(message),
      (key, value: unknown) => (key.toLowerCase() === "device_key" ? "••••" : value),
      2,
    );
  } catch {
    // MQTT can carry plain text or an incomplete preview of a large packet.
  }
  preview = preview.replace(/smrb_[0-9a-f]+/gi, "••••");
  return preview.length > 2048 ? `${preview.slice(0, 2048)}…` : preview;
}

export const mqttDefaults: MqttSettings = {
  host: "broker.hivemq.com",
  websocketPort: 8884,
  websocketPath: "/mqtt",
  sensorTopic: "medicine/sensor",
  scheduleTopic: "medicine/schedule",
  payload: "",
  medicineIds: null,
};

export function boxTopic(prefix: string, deviceId: string) {
  return `${prefix}/${deviceId}`;
}
