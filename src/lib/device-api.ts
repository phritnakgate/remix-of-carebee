// Helpers for the public ESP32 endpoints. Only call from server route handlers.
import { hashDeviceKey } from "./device-keys";
import { doseTargetsBox, scheduleCompartment, scheduleFood, type Medicine, type Schedule } from "./medication";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Key",
};

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function readKey(request: Request): string | null {
  const header = request.headers.get("x-device-key");
  if (header) return header.trim();
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return null;
}

/** Verifies the device key and returns the device plus a privileged client. */
export async function authenticateDevice(request: Request) {
  const key = readKey(request);
  if (!key || !/^smrb_[0-9a-f]{48}$/.test(key)) return { error: json({ error: "Missing or invalid device key" }, 401) } as const;
  const keyHash = await hashDeviceKey(key);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: keyRow } = await supabaseAdmin.from("device_keys").select("device_id").eq("key_hash", keyHash).maybeSingle();
  if (!keyRow) return { error: json({ error: "Unknown device key" }, 401) } as const;
  const { data: device } = await supabaseAdmin.from("devices").select("*").eq("id", keyRow.device_id).single();
  if (!device || device.mode !== "real") return { error: json({ error: "Unknown device" }, 401) } as const;
  const { data: profile } = await supabaseAdmin.from("profiles").select("timezone").eq("id", device.owner_id).maybeSingle();
  return { device, admin: supabaseAdmin, timezone: profile?.timezone || "Asia/Bangkok" } as const;
}

/** Current local date, weekday (0 = Sunday) and minutes since midnight in a time zone. */
export function zonedNow(timeZone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: weekdays.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    second: Number(get("second")),
  };
}

export function timeToMinutes(time: string) {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

type Admin = Awaited<ReturnType<typeof authenticateDevice>> extends infer R ? (R extends { admin: infer A } ? A : never) : never;

/** Today's doses for the device owner, in the owner's time zone. */
export async function todaysDoses(admin: Admin, ownerId: string, timeZone: string, deviceId: string, at = new Date()) {
  const now = zonedNow(timeZone, at);
  const [medicines, scheduleRows, confirmations] = await Promise.all([
    admin.from("medicines").select("*").eq("owner_id", ownerId),
    admin.from("medication_schedules").select("*").eq("owner_id", ownerId),
    admin.from("dose_logs").select("schedule_id, confirmed_at, source").eq("owner_id", ownerId).eq("scheduled_date", now.date),
  ]);
  const error = medicines.error ?? scheduleRows.error ?? confirmations.error;
  if (error) throw error;
  const meds: Medicine[] | null = medicines.data;
  const schedules: Schedule[] | null = scheduleRows.data;
  const logs = confirmations.data;
  const medById = new Map((meds ?? []).map((m) => [m.id, m]));
  const logBySchedule = new Map((logs ?? []).map((l) => [l.schedule_id, l]));
  const doses = (schedules ?? [])
    .filter((s) => {
      if (s.ends_on && now.date >= s.ends_on) return false;
      const medicine = medById.get(s.medicine_id);
      if (!s.days_of_week.includes(now.weekday) || !medicine?.active || !doseTargetsBox(s, medicine, deviceId)) return false;
      const createdAt = new Date(s.created_at);
      const created = zonedNow(timeZone, createdAt);
      return created.date < now.date || (created.date === now.date && (
        created.minutes < timeToMinutes(s.dose_time) || (
          created.minutes === timeToMinutes(s.dose_time) && created.second === 0 && createdAt.getMilliseconds() === 0
        )
      ));
    })
    .map((s) => {
      const m = medById.get(s.medicine_id)!;
      const log = logBySchedule.get(s.id);
      return {
        schedule_id: s.id,
        medicine_id: m.id,
        medicine: m.name,
        dosage: m.dosage,
        pills: m.pills_per_dose,
        food_instruction: scheduleFood(s, m),
        compartment: scheduleCompartment(s, m),
        ...((s.box_slot || m.device_id) ? { box_slot: s.box_slot ?? null, device_id: m.device_id ?? null } : {}),
        slot: s.slot,
        time: s.dose_time.slice(0, 5),
        reminder: s.notify,
        taken: !!log,
        confirmed_at: log?.confirmed_at ?? null,
      };
    })
    .sort((a, b) => a.time.localeCompare(b.time));
  return { now, doses };
}

export async function touchDevice(admin: Admin, device: { id: string; first_contact_at: string | null }, extra: Record<string, unknown> = {}) {
  const ts = new Date().toISOString();
  const { error } = await admin
    .from("devices")
    .update({ last_seen_at: ts, first_contact_at: device.first_contact_at ?? ts, ...extra })
    .eq("id", device.id);
  if (error) throw error;
  return ts;
}
