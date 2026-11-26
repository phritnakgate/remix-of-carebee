import { z } from "zod";

import type { Json } from "@/integrations/supabase/types";
import { authenticateDevice, json, zonedNow } from "@/lib/device-api";
import { partialIntakeSchema, rtcReportSchema } from "./rtc";
import { hashDeviceKey } from "./device-keys";
import { rtcDb } from "./rtc-db";
import {
  defaultSensorTemplate,
  isLoadCellReport,
  nextLoadCellStatus,
  parseSensorTemplate,
  readLoadCellReport,
} from "@/lib/load-cell";
import type { DeviceStatusPayload } from "@/lib/medication";
import { readSharedTemplate } from "@/lib/reminder-template.server";

const StatusSchema = z.object({
  led: z.enum(["on", "off", "blinking"]).optional(),
  buzzer: z.enum(["on", "off"]).optional(),
  compartments: z
    .array(
      z.object({
        number: z.number().int().min(1).max(28),
        open: z.boolean().optional(),
        has_pills: z.boolean().optional(),
      }),
    )
    .max(28)
    .optional(),
  wifi_rssi: z.number().int().min(-120).max(0).optional(),
  battery: z.number().min(0).max(100).optional(),
  firmware: z.string().max(40).optional(),
});

export async function receiveDeviceStatus(request: Request, expectedDeviceId?: string) {
  const auth = await authenticateDevice(request);
  if ("error" in auth) return auth.error;
  if (expectedDeviceId && auth.device.id !== expectedDeviceId) {
    return json({ error: "Device key does not match the box" }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  return applyStandardStatus(auth, body);
}

function applyStandardStatus(auth: DeviceAuth, body: unknown) {
  const parsed = StatusSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid status", issues: parsed.error.issues }, 400);
  const { firmware, ...status } = parsed.data;
  return applyStatus(auth, (previous) => {
    const changed =
      previous.led !== status.led ||
      previous.buzzer !== status.buzzer ||
      JSON.stringify(previous.compartments ?? null) !== JSON.stringify(status.compartments ?? null);
    return {
      status: { ...previous, ...status },
      event: changed ? status : null,
      ...(firmware ? { firmware } : {}),
    };
  });
}

export async function receiveMqttStatus(
  request: Request,
  expectedDeviceId?: string,
  legacyStatus?: Record<string, unknown>,
) {
  const auth = await authenticateDevice(request);
  if ("error" in auth) return auth.error;
  if (expectedDeviceId && auth.device.id !== expectedDeviceId) {
    return json({ error: "Device key does not match the box" }, 403);
  }

  let template = defaultSensorTemplate;
  try {
    const shared = await readSharedTemplate("sensor");
    if (shared.template) template = parseSensorTemplate(shared.template);
  } catch {
    // ESP32 devices can still send the standard format if the shared settings are unavailable.
  }
  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > 8192) return json({ error: "Sensor report is too large" }, 413);
    payload = JSON.parse(text);
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (
    payload &&
    typeof payload === "object" &&
    "type" in payload &&
    payload.type === "schedule_ack"
  ) {
    const { acknowledgeRtcChannel } = await import("./rtc-ack.server");
    return acknowledgeRtcChannel(auth, payload);
  }
  if (payload && typeof payload === "object" && "type" in payload && payload.type === "intake_partial") {
    const parsed = partialIntakeSchema.safeParse(payload);
    if (!parsed.success) return json({ error: "Invalid partial intake report" }, 400);
    const report = parsed.data;
    if (report.deviceId !== auth.device.id)
      return json({ error: "Device ID does not match the key" }, 403);
    const digest = await hashDeviceKey(`intake_partial:${report.deviceId}:${report.compartment}:${report.scheduledDate}`);
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
    const { error } = await auth.admin.from("device_events").upsert({
      id,
      device_id: auth.device.id,
      owner_id: auth.device.owner_id,
      event_type: "intake_partial",
      source: "real",
      payload: { compartment: report.compartment, scheduledDate: report.scheduledDate, removedWeightG: report.removedWeightG },
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) return json({ error: "Could not save partial intake" }, 500);
    return applyStatus(auth, (previous) => ({ status: { ...previous }, event: null }));
  }
  const rtcReport = rtcReportSchema.safeParse(payload);
  if (rtcReport.success) {
    const report = rtcReport.data;
    if (report.deviceId !== auth.device.id)
      return json({ error: "Device ID does not match the key" }, 403);
    const date = report.scheduledDate ?? zonedNow(auth.timezone, new Date()).date;
    if (report.isTake) {
      const result = await rtcDb(auth.admin).rpc("confirm_box_compartment", {
        _device_id: auth.device.id,
        _compartment: report.compartment,
        _date: date,
      });
      if (result.error) return json({ error: "Could not confirm compartment" }, 500);
      if (result.data < 0)
        return json({ error: "No medicines scheduled in this compartment" }, 404);
    }
    return applyStatus(auth, (previous) => {
      const key = String(report.compartment);
      const reading =
        typeof report.weight === "number"
          ? nextLoadCellStatus(
              { compartment: report.compartment, weight_g: report.weight },
              previous.load_cells?.[key],
              template.thresholdGrams,
            )
          : null;
      const prior = previous.intakes?.[key];
      return {
        status: {
          ...previous,
          ...(reading ? { load_cells: { ...previous.load_cells, [key]: reading.status } } : {}),
          intakes: {
            ...previous.intakes,
            [key]: {
              date,
              isTake: report.isTake || (prior?.date === date && prior.isTake),
            },
          },
        },
        event: reading?.change ?? null,
      };
    });
  }
  if (!isLoadCellReport(payload, template) && legacyStatus !== undefined) {
    return applyStandardStatus(auth, legacyStatus);
  }
  const reading = readLoadCellReport(payload, template);
  if (!reading) return json({ error: "Invalid load cell report" }, 400);

  const compartment = reading.compartment === null ? "box" : String(reading.compartment);
  return applyStatus(auth, (previous) => {
    const { status, change } = nextLoadCellStatus(
      reading,
      previous.load_cells?.[compartment],
      template.thresholdGrams,
    );
    return {
      status: { ...previous, load_cells: { ...previous.load_cells, [compartment]: status } },
      event: change,
    };
  });
}

type DeviceAuth = Exclude<Awaited<ReturnType<typeof authenticateDevice>>, { error: Response }>;

export async function applyStatus(
  { device, admin }: DeviceAuth,
  changes: (previous: DeviceStatusPayload) => {
    status: Json;
    event: Json;
    firmware?: string;
  },
) {
  let snapshot: Pick<typeof device, "last_status" | "first_contact_at"> = device;
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = (snapshot.last_status ?? {}) as DeviceStatusPayload;
    const { status, event, firmware } = changes(previous);
    const ts = new Date().toISOString();
    const write = admin
      .from("devices")
      .update({
        last_status: status,
        last_seen_at: ts,
        first_contact_at: snapshot.first_contact_at ?? ts,
        ...(firmware ? { firmware } : {}),
      })
      .eq("id", device.id)
      .eq("mode", "real");

    // MQTT can be open in multiple tabs. Merge only with the snapshot we read.
    if (snapshot.last_status === null) write.is("last_status", null);
    else write.filter("last_status", "eq", JSON.stringify(snapshot.last_status));
    if (snapshot.first_contact_at === null) write.is("first_contact_at", null);

    const { data: updated, error } = await write.select("id").maybeSingle();
    if (error) return json({ error: "Could not save status" }, 500);
    if (updated) {
      if (event || !snapshot.first_contact_at) {
        await admin.from("device_events").insert({
          device_id: device.id,
          owner_id: device.owner_id,
          event_type: snapshot.first_contact_at ? "status_changed" : "first_contact",
          payload: event ?? status,
          source: "real",
        });
      }
      return json({ ok: true, server_time: ts });
    }

    const { data } = await admin
      .from("devices")
      .select("last_status,first_contact_at")
      .eq("id", device.id)
      .eq("mode", "real")
      .maybeSingle();
    if (!data) break;
    snapshot = data;
  }
  return json({ error: "Status update conflicted with another report" }, 409);
}
