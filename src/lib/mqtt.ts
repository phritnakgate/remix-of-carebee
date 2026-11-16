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
    transport: z.enum(["mqtt", "ws", "mqtts", "wss"]),
    ports: z.object({ mqtt: port, ws: port, mqtts: port, wss: port }),
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
export type MqttTransport = MqttSettings["transport"];
export type MqttState = "disconnected" | "connecting" | "connected";

export const mqttCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), deviceId: z.string().uuid() }),
  z.object({
    action: z.literal("connect"),
    deviceId: z.string().uuid(),
    settings: mqttSettingsSchema,
  }),
  z.object({ action: z.literal("disconnect"), deviceId: z.string().uuid() }),
]);

export type MqttCommand = z.infer<typeof mqttCommandSchema>;

export interface MqttConnection {
  settings: MqttSettings;
  enabled: boolean;
  state: MqttState;
  failed: boolean;
}

export const mqttDefaults: MqttSettings = {
  host: "",
  transport: "mqtts",
  ports: { mqtt: 1883, ws: 8083, mqtts: 8883, wss: 8084 },
  websocketPath: "/mqtt",
  sensorTopic: "medicine/sensor",
  scheduleTopic: "medicine/schedule",
  payload: "",
  medicineIds: null,
};

export function boxTopic(prefix: string, deviceId: string) {
  return `${prefix}/${deviceId}`;
}
