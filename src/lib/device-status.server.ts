import { z } from "zod";

import { authenticateDevice, json, touchDevice } from "@/lib/device-api";

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
  const { device, admin } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  const parsed = StatusSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid status", issues: parsed.error.issues }, 400);
  const { firmware, ...status } = parsed.data;

  const prev = (device.last_status ?? {}) as Record<string, unknown>;
  const changed =
    prev["led"] !== status.led ||
    prev["buzzer"] !== status.buzzer ||
    JSON.stringify(prev["compartments"] ?? null) !== JSON.stringify(status.compartments ?? null);

  const ts = await touchDevice(admin, device, {
    last_status: status,
    ...(firmware ? { firmware } : {}),
  });
  if (changed || !device.first_contact_at) {
    await admin.from("device_events").insert({
      device_id: device.id,
      owner_id: device.owner_id,
      event_type: device.first_contact_at ? "status_changed" : "first_contact",
      payload: status,
      source: "real",
    });
  }
  return json({ ok: true, server_time: ts });
}
