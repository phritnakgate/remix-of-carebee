import { z } from "zod";
import { scheduleCompartment, type Medicine, type Schedule } from "./medication";

export const RTC_CHANNELS = [1, 2, 3, 4, 5, 6] as const;
export const rtcReportSchema = z
  .object({
    deviceId: z.string().uuid(),
    compartment: z.number().int().min(1).max(6),
    weight: z.number().finite().min(-10000).max(10000).nullable().optional(),
    isTake: z.boolean(),
    scheduledDate: z.string().date().optional(),
  })
  .passthrough();

export const partialIntakeSchema = z.object({
  type: z.literal("intake_partial"),
  deviceId: z.string().uuid(),
  compartment: z.number().int().min(1).max(6),
  scheduledDate: z.string().date(),
  removedWeightG: z.number().finite().positive().max(10000),
});

export function rtcMqttPayload(channel: {
  compartment: number;
  time: string | null;
  days: number[];
}, expectedDoseG?: number | null) {
  return {
    compartment: channel.compartment,
    time: channel.time,
    ...(channel.time && channel.days.length && expectedDoseG != null ? { expectedDoseG } : {}),
    ...(channel.days.length === 7 ? {} : { days: channel.days }),
  };
}

export function rtcChannels(
  medicines: Medicine[],
  schedules: Schedule[],
  deviceId: string,
  date: string,
) {
  const meds = new Map(
    medicines.filter((m) => m.active && m.device_id === deviceId).map((m) => [m.id, m]),
  );
  return RTC_CHANNELS.map((compartment) => {
    const rows = schedules.filter((s) => {
      const med = meds.get(s.medicine_id);
      return med && (!s.ends_on || s.ends_on > date) && scheduleCompartment(s, med) === compartment;
    });
    const times = new Set(rows.map((s) => s.dose_time.slice(0, 5)));
    if (times.size > 1)
      throw new Error("Different times are configured for the same box compartment");
    const enabled = rows.filter((s) => s.notify);
    return {
      compartment,
      time: enabled.length ? enabled[0]!.dose_time.slice(0, 5) : null,
      days: [...new Set(enabled.flatMap((s) => s.days_of_week))].sort(),
    };
  });
}
