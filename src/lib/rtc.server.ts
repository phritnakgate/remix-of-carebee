import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readSchedule } from "./medication";
import { rtcChannels } from "./rtc";
import { zonedNow } from "./device-api";
import { hashDeviceKey } from "./device-keys";

export async function readRtcSchedule(deviceId: string, ownerId: string) {
  const [meds, schedules, profile] = await Promise.all([
    supabaseAdmin.from("medicines").select("*").eq("owner_id", ownerId),
    supabaseAdmin.from("medication_schedules").select("*").eq("owner_id", ownerId),
    supabaseAdmin.from("profiles").select("timezone").eq("id", ownerId).maybeSingle(),
  ]);
  const error = meds.error ?? schedules.error ?? profile.error;
  if (error) throw error;
  const timezone = profile.data?.timezone || "Asia/Bangkok";
  const at = new Date();
  const now = zonedNow(timezone, at);
  const channels = rtcChannels(
    meds.data ?? [],
    (schedules.data ?? []).map(readSchedule),
    deviceId,
    now.date,
  );
  const timing = channels.map(({ compartment, time, days }) => ({ compartment, time, days }));
  return {
    revision: await hashDeviceKey(JSON.stringify({ timezone, channels: timing })),
    deviceId,
    timezone,
    channels,
  };
}
