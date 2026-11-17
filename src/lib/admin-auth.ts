import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | undefined;

export function adminAuth() {
  if (client) return client.auth;
  const url = import.meta.env["VITE_SUPABASE_URL"];
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Supabase browser configuration is missing");

  client = createClient(url, key, {
    auth: {
      storageKey: "carebee-admin-session",
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch(input, init) {
        const headers = new Headers(
          init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        if (key.startsWith("sb_publishable_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        return fetch(input, { ...init, headers });
      },
    },
  });
  return client.auth;
}

export function adminHeaders(token: string) {
  return { "X-CareBee-Admin-Token": token };
}
