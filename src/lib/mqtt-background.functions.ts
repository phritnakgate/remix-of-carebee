import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mqttSettingsSchema } from "./mqtt";

const box = z.object({ deviceId: z.string().uuid() });

export const getMqttBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(box)
  .handler(async ({ data, context }) => {
    const device = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_id", context.userId)
      .eq("mode", "real")
      .maybeSingle();
    if (device.error) throw device.error;
    if (!device.data) throw new Error("Box not accessible");
    const { getBackgroundConfig } = await import("./mqtt-background.server");
    return getBackgroundConfig(data.deviceId);
  });

export const saveMqttBackground = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.discriminatedUnion("enabled", [
      box.extend({ enabled: z.literal(true), settings: mqttSettingsSchema }),
      box.extend({ enabled: z.literal(false) }),
    ]),
  )
  .handler(async ({ data, context }) => {
    const device = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_id", context.userId)
      .eq("mode", "real")
      .maybeSingle();
    if (device.error) throw device.error;
    if (!device.data) throw new Error("Box not accessible");
    const { backgroundDb, backgroundSettings, getBackgroundConfig } =
      await import("./mqtt-background.server");
    if (!data.enabled) {
      const { error } = await backgroundDb()
        .from("mqtt_background_configs")
        .update({ enabled: false, last_error: null })
        .eq("device_id", data.deviceId)
        .eq("owner_id", context.userId);
      if (error) throw error;
      return true;
    }
    const status = await getBackgroundConfig(data.deviceId);
    if (!status.lastTick || Date.now() - new Date(status.lastTick).getTime() > 180000) {
      throw new Error("Background timer is not running");
    }
    const settings = backgroundSettings(data.settings);
    const { error } = await backgroundDb()
      .from("mqtt_background_configs")
      .upsert({
        device_id: data.deviceId,
        owner_id: context.userId,
        enabled: data.enabled,
        settings,
        last_error: null,
        enabled_at: status.config?.enabled ? status.config.enabled_at : new Date().toISOString(),
      });
    if (error) throw error;
    return true;
  });
