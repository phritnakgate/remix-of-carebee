import { timingSafeEqual } from "node:crypto";
import { hashDeviceKey } from "./device-keys";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { backgroundDb, backgroundSettings } from "./mqtt-background.server";
import { timeToMinutes, todaysDoses } from "./device-api";
import { boxTopic, mqttPayloadLimit } from "./mqtt";
import { scheduledReminderPayload } from "./reminder-template";
import { readSharedTemplate } from "./reminder-template.server";
import { withMqttPublisher } from "./mqtt-publish.server";

export async function runMqttJob(request: Request) {
  const token = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || token.length > 256)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = backgroundDb();
  const state = await db
    .from("mqtt_job_state")
    .select("token_hash")
    .eq("id", "default")
    .maybeSingle();
  if (state.error || !state.data)
    return Response.json({ error: "Job is not configured" }, { status: 503 });
  const provided = await hashDeviceKey(token);
  const expected = state.data.token_hash;
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await db.rpc("mqtt_due_boxes", {});
  if (due.error) return Response.json({ error: "Could not read due reminders" }, { status: 503 });
  const heartbeat = await db
    .from("mqtt_job_state")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", "default");
  if (heartbeat.error)
    return Response.json({ error: "Could not update job status" }, { status: 503 });

  const shared = await readSharedTemplate("reminder").catch(() => ({ template: "" }));
  const deadline = Date.now() + 23000;
  let cursor = 0;
  let sent = 0;
  let failed = 0;
  const devices = due.data ?? [];
  async function worker() {
    while (cursor < devices.length && Date.now() < deadline) {
      const box = devices[cursor++];
      if (!box) break;
      try {
        sent += await sendForBox(box.device_id, shared.template, deadline);
      } catch {
        failed++;
        await db
          .from("mqtt_background_configs")
          .update({
            last_checked_at: new Date().toISOString(),
            last_error: "delivery_failed",
          })
          .eq("device_id", box.device_id)
          .eq("enabled", true);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, devices.length) }, worker));
  return Response.json(
    { ok: failed === 0, sent, failed, deferred: devices.length - cursor },
    {
      status: failed ? 502 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function sendForBox(deviceId: string, template: string, deadline: number) {
  const db = backgroundDb();
  const config = await db
    .from("mqtt_background_configs")
    .select("*")
    .eq("device_id", deviceId)
    .eq("enabled", true)
    .maybeSingle();
  if (config.error) throw config.error;
  if (!config.data) return 0;
  const settings = backgroundSettings(config.data.settings);
  const device = await supabaseAdmin
    .from("devices")
    .select("id,owner_id")
    .eq("id", deviceId)
    .eq("owner_id", config.data.owner_id)
    .eq("mode", "real")
    .maybeSingle();
  if (device.error) throw device.error;
  if (!device.data) return 0;
  const profile = await supabaseAdmin
    .from("profiles")
    .select("timezone")
    .eq("id", device.data.owner_id)
    .maybeSingle();
  if (profile.error) throw profile.error;
  const timezone = profile.data?.timezone ?? "Asia/Bangkok";
  const at = Date.now();
  const messages: {
    scheduleId: string;
    date: string;
    payload: string;
    token: string;
    expires: number;
  }[] = [];
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = new Date(at - offset * 60000);
    const { now, doses } = await todaysDoses(
      supabaseAdmin,
      device.data.owner_id,
      timezone,
      deviceId,
      candidate,
    );
    for (const dose of doses) {
      if (!dose.reminder || dose.taken || timeToMinutes(dose.time) !== now.minutes) continue;
      if (
        !dose.device_id &&
        settings.medicineIds &&
        !settings.medicineIds.includes(dose.medicine_id)
      )
        continue;
      const notificationId = `${deviceId}:${now.date}:${dose.schedule_id}`;
      const payload = scheduledReminderPayload(
        {
          type: "medication_due",
          notification_id: notificationId,
          box_id: deviceId,
          date: now.date,
          timezone,
          ...dose,
        },
        template,
        "",
        settings.payload,
      );
      if (!payload.trim() || payload.length > mqttPayloadLimit)
        throw new Error("Invalid reminder payload");
      messages.push({
        scheduleId: dose.schedule_id,
        date: now.date,
        payload,
        token: crypto.randomUUID(),
        expires: (Math.floor(candidate.getTime() / 60000) + 3) * 60000,
      });
    }
  }
  const checked = await db
    .from("mqtt_background_configs")
    .update({
      last_checked_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("device_id", deviceId);
  if (checked.error) throw checked.error;
  if (!messages.length || Date.now() >= deadline) return 0;

  let sent = 0;
  await withMqttPublisher(settings, async (publish) => {
    for (const message of messages) {
      if (Date.now() >= deadline || Date.now() >= message.expires) break;
      const args = {
        _device_id: deviceId,
        _schedule_id: message.scheduleId,
        _date: message.date,
        _token: message.token,
      };
      const claim = await db.rpc("claim_mqtt_delivery", {
        ...args,
        _payload: message.payload,
        _settings: settings,
      });
      if (claim.error) throw claim.error;
      const leased = claim.data?.[0];
      if (!leased) continue;
      try {
        await publish(boxTopic(settings.scheduleTopic, deviceId), leased.payload);
        const finished = await db.rpc("finish_mqtt_delivery", { ...args, _success: true });
        if (finished.error || !finished.data)
          throw new Error("Could not record MQTT acknowledgement");
        sent++;
      } catch (error) {
        await db.rpc("finish_mqtt_delivery", { ...args, _success: false });
        throw error;
      }
    }
  });
  return sent;
}
