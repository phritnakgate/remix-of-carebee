import type { MqttClient } from "mqtt";
import { mqttBrokerUrl, type MqttSettings } from "./mqtt";

export async function withMqttPublisher(
  settings: MqttSettings,
  operation: (publish: (topic: string, payload: string) => Promise<void>) => Promise<void>,
) {
  // Use the WebSocket bundle on Lovable's Worker runtime.
  const { default: mqtt } = await import("mqtt/dist/mqtt.esm");
  let client: MqttClient | undefined;
  let transport: WebSocket | undefined;
  let active = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("MQTT delivery timed out")), 12000);
      const socket = mqtt.connect(mqttBrokerUrl(settings), {
        manualConnect: true,
        reconnectPeriod: 0,
        connectTimeout: 8000,
        keepalive: 15,
        clean: true,
        forceNativeWebSocket: true,
        createWebsocket(url, protocols) {
          transport = new WebSocket(url, protocols);
          return transport;
        },
      });
      client = socket;
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("MQTT disconnected before completion")));
      socket.once("connect", () => {
        void operation(
          (topic, payload) =>
            new Promise<void>((sent, failed) => {
              if (!active || !socket.connected) {
                failed(new Error("MQTT connection is closed"));
                return;
              }
              socket.publish(topic, payload, { qos: 1, retain: false }, (error) =>
                error ? failed(error) : sent(),
              );
            }),
        ).then(resolve, reject);
      });
      socket.connect();
    });
  } finally {
    active = false;
    clearTimeout(timeout);
    try {
      client?.end(true);
    } finally {
      if (transport && transport.readyState < WebSocket.CLOSING) transport.close();
    }
  }
}
