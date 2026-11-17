import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mqttSensorSchema } from "./mqtt";

const box = z.object({ deviceId: z.string().uuid() });

export const getMqttDue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => box.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: device, error } = await supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_id", userId)
      .eq("mode", "real")
      .maybeSingle();
    if (error) throw error;
    if (!device) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) throw profileError;
    const timezone = profile?.timezone || "Asia/Bangkok";
    const { timeToMinutes, todaysDoses } = await import("./device-api");
    const at = new Date();
    const { now, doses } = await todaysDoses(supabase, userId, timezone, device.id, at);
    const due = doses.filter(
      (dose) => dose.reminder && !dose.taken && timeToMinutes(dose.time) === now.minutes,
    );
    let reminderTemplate = "";
    if (due.length) {
      try {
        const { readSharedReminderTemplate } = await import("./reminder-template.server");
        reminderTemplate = (await readSharedReminderTemplate()).template;
      } catch {
        // A template lookup failure must not block the scheduled reminder.
      }
    }
    return {
      date: now.date,
      timezone,
      minute: Math.floor(at.getTime() / 60000),
      doses: due,
      reminderTemplate,
    };
  });

export const forwardMqttSensor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => box.extend({ message: z.string().max(8192) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: device } = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_id", context.userId)
      .eq("mode", "real")
      .maybeSingle();
    if (!device) return false;

    let payload: unknown;
    try {
      payload = JSON.parse(data.message);
    } catch {
      return false;
    }
    const parsed = mqttSensorSchema.safeParse(payload);
    if (!parsed.success) return false;
    const { device_key, ...report } = parsed.data;
    const request = new Request("https://carebee.invalid/device", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Device-Key": device_key },
      body: JSON.stringify("status" in report ? report.status : report),
    });
    if ("status" in report) {
      const { receiveDeviceStatus } = await import("./device-status.server");
      return (await receiveDeviceStatus(request, device.id)).ok;
    }
    const { confirmDeviceDose } = await import("./device-confirm.server");
    return (await confirmDeviceDose(request, device.id)).ok;
  });
