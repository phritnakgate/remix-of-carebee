import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getRtcSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ deviceId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const device = await context.supabase
      .from("devices")
      .select("id,owner_id")
      .eq("id", data.deviceId)
      .eq("mode", "real")
      .maybeSingle();
    if (device.error) throw device.error;
    if (!device.data) throw new Error("Box not accessible");
    const { readRtcSchedule } = await import("./rtc.server");
    return readRtcSchedule(data.deviceId, device.data.owner_id);
  });
