import { z } from "zod";
import { json } from "./device-api";
import { readRtcSchedule } from "./rtc.server";
import { applyStatus } from "./device-status.server";
import { backgroundDb, getBackgroundConfig } from "./mqtt-background.server";

const schema = z.object({
  deviceId: z.string().uuid(),
  compartment: z.number().int().min(1).max(6),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export async function acknowledgeRtcChannel(
  auth: Parameters<typeof applyStatus>[0],
  payload: unknown,
) {
  const ack = schema.safeParse(payload);
  if (!ack.success) return json({ error: "Invalid schedule acknowledgement" }, 400);
  if (ack.data.deviceId !== auth.device.id)
    return json({ error: "Device ID does not match key" }, 403);
  const current = await readRtcSchedule(auth.device.id, auth.device.owner_id);
  const channel = current.channels.find((item) => item.compartment === ack.data.compartment)!;
  const days = [...new Set(ack.data.days ?? [0, 1, 2, 3, 4, 5, 6])].sort();
  if (channel.time !== ack.data.time || JSON.stringify(days) !== JSON.stringify(channel.days)) {
    return json({ error: "The saved schedule is outdated" }, 409);
  }
  let completed = false;
  const recorded = await applyStatus(auth, (previous) => {
    const acknowledgements =
      previous.rtc_sync_revision === current.revision ? previous.rtc_channels : {};
    const saved: Record<string, boolean> = {
      ...acknowledgements,
      [String(channel.compartment)]: true,
    };
    completed = current.channels.every((item) => saved[String(item.compartment)]);
    return {
      status: {
        ...previous,
        rtc_sync_revision: current.revision,
        rtc_channels: saved,
        ...(completed ? { rtc_revision: current.revision } : {}),
      },
      event:
        completed && previous.rtc_revision !== current.revision
          ? { rtc_revision: current.revision }
          : null,
    };
  });
  if (!recorded.ok) return recorded;
  if (completed) {
    const background = await getBackgroundConfig(auth.device.id);
    if (background.config?.enabled) {
      const { error } = await backgroundDb()
        .from("mqtt_background_configs")
        .update({ enabled: false })
        .eq("device_id", auth.device.id)
        .eq("owner_id", auth.device.owner_id);
      if (error) return json({ error: "Could not stop server reminders" }, 500);
    }
  }
  return json({ ok: true, synced: completed });
}
