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

type RtcChannel = {
  compartment: number;
  time: string | null;
  days: number[];
  expectedDoseG?: number;
};

export function rtcMqttPayload(channel: RtcChannel, weightOverrideG?: number | null) {
  const expectedDoseG = weightOverrideG ?? channel.expectedDoseG;
  return {
    compartment: channel.compartment,
    time: channel.time,
    ...(channel.time && channel.days.length && expectedDoseG != null ? { expectedDoseG } : {}),
    ...(channel.days.length === 7 ? {} : { days: channel.days }),
  };
}

function doseGrams(medicine: Medicine) {
  const dosage = medicine.dosage?.trim().toLowerCase();
  const parsed = dosage?.match(/^(\d+(?:\.\d+)?|\.\d+)\s*(mg|มก\.?|มิลลิกรัม|g|กรัม|ก\.|mcg|[µμu]g|ไมโครกรัม|มคก\.?)$/u);
  if (!parsed) return null;
  const [, amount, unit] = parsed;
  const divisor =
    unit === "g" || unit === "กรัม" || unit === "ก." ? 1 :
    unit === "mg" || unit === "มก" || unit === "มก." || unit === "มิลลิกรัม" ? 1000 : 1000000;
  const grams = Number(amount) * medicine.pills_per_dose / divisor;
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

export function rtcChannels(
  medicines: Medicine[],
  schedules: Schedule[],
  deviceId: string,
  date: string,
): RtcChannel[] {
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
    const days = [...new Set(enabled.flatMap((s) => s.days_of_week))].sort();
    const dailyTotals = days.map((day) => {
      const medicineIds = new Set(rows.filter((row) => row.days_of_week.includes(day)).map((row) => row.medicine_id));
      let total = 0;
      for (const id of medicineIds) {
        const grams = doseGrams(meds.get(id)!);
        if (grams === null) return null;
        total += grams;
      }
      return Number(total.toFixed(9));
    });
    // Firmware stores one reference per compartment for the whole recurring schedule.
    const [firstTotal] = dailyTotals;
    const expectedDoseG = firstTotal != null && firstTotal > 0 && firstTotal <= 10000 &&
      dailyTotals.every((total) => total === firstTotal)
      ? firstTotal
      : undefined;
    return {
      compartment,
      time: enabled.length ? enabled[0]!.dose_time.slice(0, 5) : null,
      days,
      ...(expectedDoseG != null ? { expectedDoseG } : {}),
    };
  });
}
