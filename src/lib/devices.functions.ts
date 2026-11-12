import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateDeviceKey, hashDeviceKey } from "./device-keys";

export const registerRealDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ name: z.string().trim().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }) => {
    const key = generateDeviceKey();
    const keyHash = await hashDeviceKey(key);
    // Real devices can only be created here, for the verified signed-in user.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: device, error } = await supabaseAdmin
      .from("devices")
      .insert({ owner_id: context.userId, name: data.name, mode: "real", key_prefix: key.slice(0, 10) })
      .select("id")
      .single();
    if (error || !device) throw new Error("Could not register the device");
    const { error: keyErr } = await supabaseAdmin.from("device_keys").insert({ device_id: device.id, key_hash: keyHash });
    if (keyErr) {
      await supabaseAdmin.from("devices").delete().eq("id", device.id);
      throw new Error("Could not create the device key");
    }
    return { deviceId: device.id, key };
  });

export const rotateDeviceKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ deviceId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: device } = await context.supabase
      .from("devices")
      .select("id, owner_id, mode")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!device || device.owner_id !== context.userId || device.mode !== "real") throw new Error("Forbidden");
    const key = generateDeviceKey();
    const keyHash = await hashDeviceKey(key);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("device_keys")
      .upsert({ device_id: device.id, key_hash: keyHash, created_at: new Date().toISOString() });
    if (error) throw new Error("Could not rotate the key");
    await supabaseAdmin.from("devices").update({ key_prefix: key.slice(0, 10) }).eq("id", device.id);
    return { key };
  });
