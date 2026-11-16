import type { MqttCommand, MqttConnection } from "./mqtt";

export async function requestMqttBridge(body: MqttCommand) {
  const url = process.env["MQTT_BRIDGE_URL"];
  const token = process.env["MQTT_BRIDGE_TOKEN"];
  if (!url || !token) return { error: "unavailable" } as const;

  try {
    const response = await fetch(new URL("/connections", url), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (response.status === 409) return { error: "disconnectFirst" } as const;
    if (response.ok) return { connection: (await response.json()) as MqttConnection };
  } catch {
    // The browser only needs the localized availability state.
  }
  return { error: "unavailable" } as const;
}
