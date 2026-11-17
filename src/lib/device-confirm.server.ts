import { z } from "zod";

import {
  authenticateDevice,
  json,
  timeToMinutes,
  todaysDoses,
  touchDevice,
} from "@/lib/device-api";

const ConfirmSchema = z
  .object({
    schedule_id: z.string().uuid().optional(),
    compartment: z.number().int().min(1).max(28).optional(),
    scheduled_date: z.string().date().optional(),
  })
  .refine((v) => v.schedule_id || v.compartment, { message: "Send schedule_id or compartment" });

export async function confirmDeviceDose(request: Request, expectedDeviceId?: string) {
  const auth = await authenticateDevice(request);
  if ("error" in auth) return auth.error;
  if (expectedDeviceId && auth.device.id !== expectedDeviceId) {
    return json({ error: "Device key does not match the box" }, 403);
  }
  const { device, admin, timezone } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: "Invalid confirmation", issues: parsed.error.issues }, 400);

  await touchDevice(admin, device);
  const { now, doses } = await todaysDoses(admin, device.owner_id, timezone, device.id);
  if (expectedDeviceId && (!parsed.data.schedule_id || parsed.data.scheduled_date !== now.date)) {
    return json({ error: "Send the schedule ID and its current scheduled date" }, 400);
  }

  let dose = parsed.data.schedule_id
    ? doses.find((d) => d.schedule_id === parsed.data.schedule_id)
    : undefined;
  if (!dose && parsed.data.compartment) {
    // Nearest untaken dose today for this compartment.
    dose = doses
      .filter((d) => d.compartment === parsed.data.compartment && !d.taken)
      .sort(
        (a, b) =>
          Math.abs(timeToMinutes(a.time) - now.minutes) -
          Math.abs(timeToMinutes(b.time) - now.minutes),
      )[0];
  }
  if (!dose && parsed.data.compartment) {
    // Everything for this compartment is already confirmed today.
    dose = doses.find((d) => d.compartment === parsed.data.compartment && d.taken);
  }
  if (!dose) return json({ error: "No matching dose scheduled today" }, 404);
  if (dose.taken) return json({ ok: true, already_confirmed: true, schedule_id: dose.schedule_id });

  const { error } = await admin.from("dose_logs").insert({
    owner_id: device.owner_id,
    schedule_id: dose.schedule_id,
    medicine_id: dose.medicine_id,
    scheduled_date: now.date,
    slot: dose.slot,
    source: "device",
    device_id: device.id,
  });
  if (error?.code === "23505")
    return json({ ok: true, already_confirmed: true, schedule_id: dose.schedule_id });
  if (error) return json({ error: "Could not save confirmation" }, 500);

  const { data: med } = await admin
    .from("medicines")
    .select("quantity, pills_per_dose")
    .eq("id", dose.medicine_id)
    .single();
  if (med && med.quantity > 0) {
    await admin
      .from("medicines")
      .update({ quantity: Math.max(0, med.quantity - med.pills_per_dose) })
      .eq("id", dose.medicine_id);
  }
  await admin.from("device_events").insert({
    device_id: device.id,
    owner_id: device.owner_id,
    event_type: "dose_confirmed",
    payload: {
      schedule_id: dose.schedule_id,
      medicine: dose.medicine,
      compartment: dose.compartment,
      slot: dose.slot,
    },
    source: "real",
  });
  return json({ ok: true, schedule_id: dose.schedule_id, medicine: dose.medicine });
}
