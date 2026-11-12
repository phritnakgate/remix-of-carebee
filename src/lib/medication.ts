// Pure medication rules shared by the app pages and the ESP32 API.
import type { Database } from "@/integrations/supabase/types";

export type Medicine = Database["public"]["Tables"]["medicines"]["Row"];
export type Schedule = Database["public"]["Tables"]["medication_schedules"]["Row"];
export type DoseLog = Database["public"]["Tables"]["dose_logs"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type DeviceEvent = Database["public"]["Tables"]["device_events"]["Row"];
export type TimeSlot = Database["public"]["Enums"]["time_slot"];
export type FoodInstruction = Database["public"]["Enums"]["food_instruction"];

export const TIME_SLOTS: TimeSlot[] = ["morning", "afternoon", "evening", "bedtime"];
export const DEFAULT_SLOT_TIMES: Record<TimeSlot, string> = {
  morning: "08:00",
  afternoon: "12:00",
  evening: "18:00",
  bedtime: "21:00",
};

/** A dose not confirmed this many minutes after its scheduled time counts as missed. */
export const MISSED_GRACE_MINUTES = 60;
/** A dose is "due now" from this many minutes before its time until it is missed. */
export const DUE_SOON_MINUTES = 30;
/** A real device counts as online only if it reported within this window. */
export const DEVICE_ONLINE_WINDOW_SECONDS = 120;

export type DoseStatus = "taken" | "pending" | "missed";

export interface Dose {
  key: string;
  date: string; // yyyy-MM-dd (local)
  scheduledAt: Date;
  schedule: Schedule;
  medicine: Medicine;
  log: DoseLog | null;
  status: DoseStatus;
  dueNow: boolean;
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function scheduledDate(dateKey: string, time: string): Date {
  const [y = 1970, m = 1, d = 1] = dateKey.split("-").map(Number);
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function doseStatus(scheduledAt: Date, taken: boolean, now: Date): DoseStatus {
  if (taken) return "taken";
  const missedAfter = scheduledAt.getTime() + MISSED_GRACE_MINUTES * 60_000;
  return now.getTime() > missedAfter ? "missed" : "pending";
}

export function isDueNow(scheduledAt: Date, status: DoseStatus, now: Date): boolean {
  if (status !== "pending") return false;
  return now.getTime() >= scheduledAt.getTime() - DUE_SOON_MINUTES * 60_000;
}

/**
 * Expands weekly schedules into concrete doses for the given dates.
 * A dose only exists if its scheduled moment is after the schedule was created,
 * so adding a medicine at 10:00 does not create a "missed" 08:00 dose that day.
 */
export function expandDoses(params: {
  dates: string[];
  schedules: Schedule[];
  medicines: Medicine[];
  logs: DoseLog[];
  now: Date;
}): Dose[] {
  const medById = new Map(params.medicines.map((m) => [m.id, m]));
  const logByKey = new Map<string, DoseLog>();
  for (const l of params.logs) {
    if (l.schedule_id) logByKey.set(`${l.schedule_id}:${l.scheduled_date}`, l);
  }
  const doses: Dose[] = [];
  for (const date of params.dates) {
    const weekday = scheduledDate(date, "00:00").getDay();
    for (const s of params.schedules) {
      const med = medById.get(s.medicine_id);
      if (!med || !med.active) continue;
      if (!s.days_of_week.includes(weekday)) continue;
      const at = scheduledDate(date, s.dose_time);
      if (at.getTime() < new Date(s.created_at).getTime()) continue;
      const log = logByKey.get(`${s.id}:${date}`) ?? null;
      const status = doseStatus(at, !!log, params.now);
      doses.push({
        key: `${s.id}:${date}`,
        date,
        scheduledAt: at,
        schedule: s,
        medicine: med,
        log,
        status,
        dueNow: isDueNow(at, status, params.now),
      });
    }
  }
  return doses.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}

export function summarize(doses: Dose[]) {
  const taken = doses.filter((d) => d.status === "taken").length;
  const missed = doses.filter((d) => d.status === "missed").length;
  const pending = doses.filter((d) => d.status === "pending").length;
  const decided = taken + missed;
  return {
    total: doses.length,
    taken,
    missed,
    pending,
    adherence: decided === 0 ? null : Math.round((taken / decided) * 100),
  };
}

export type DeviceConnection = "simulated" | "awaiting_first_contact" | "online" | "offline";

/** Real hardware is only "online" after it has actually called the API recently. */
export function deviceConnection(device: Pick<Device, "mode" | "first_contact_at" | "last_seen_at">, now: Date): DeviceConnection {
  if (device.mode === "simulated") return "simulated";
  if (!device.first_contact_at || !device.last_seen_at) return "awaiting_first_contact";
  const age = (now.getTime() - new Date(device.last_seen_at).getTime()) / 1000;
  return age <= DEVICE_ONLINE_WINDOW_SECONDS ? "online" : "offline";
}

export function lastNDates(n: number, end: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    out.push(toDateKey(d));
  }
  return out;
}

export function slotForTime(time: string): TimeSlot {
  const h = Number(time.split(":")[0]);
  if (h < 11) return "morning";
  if (h < 16) return "afternoon";
  if (h < 20) return "evening";
  return "bedtime";
}

export interface DeviceStatusPayload {
  led?: "on" | "off" | "blinking";
  buzzer?: "on" | "off";
  compartments?: { number: number; open?: boolean; has_pills?: boolean }[];
  wifi_rssi?: number;
  battery?: number;
}
