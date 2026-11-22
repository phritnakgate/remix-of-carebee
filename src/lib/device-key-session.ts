import { useSyncExternalStore } from "react";

const eventName = "carebee-device-key-changed";
const storageKey = (ownerId: string, deviceId: string) => `carebee-device-key:${ownerId}:${deviceId}`;

// The database keeps only hashes. Retain newly issued keys in this tab for setup.
export function rememberDeviceKey(ownerId: string, deviceId: string, key: string) {
  try {
    sessionStorage.setItem(storageKey(ownerId, deviceId), key);
    window.dispatchEvent(new Event(eventName));
  } catch {
    // The issuance dialog still provides the key if browser storage is unavailable.
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useDeviceKey(ownerId: string, deviceId: string, prefix?: string | null) {
  return useSyncExternalStore(subscribe, () => {
    if (!prefix) return null;
    try {
      const key = sessionStorage.getItem(storageKey(ownerId, deviceId));
      return key && /^smrb_[0-9a-f]{48}$/.test(key) && key.startsWith(prefix) ? key : null;
    } catch {
      return null;
    }
  }, () => null);
}
