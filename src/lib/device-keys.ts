// Device keys: random secret given to the ESP32 once; only its SHA-256 hash is stored.
export const DEVICE_KEY_PREFIX = "smrb_";

export function generateDeviceKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return DEVICE_KEY_PREFIX + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashDeviceKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
