import { createFileRoute } from "@tanstack/react-router";

import { authenticateDevice, json, preflight, todaysDoses, touchDevice } from "@/lib/device-api";

// ESP32 pulls today's doses so it knows when to light up and beep.
export const Route = createFileRoute("/api/public/device/schedule")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const auth = await authenticateDevice(request);
        if ("error" in auth) return auth.error;
        const { device, admin, timezone } = auth;
        const ts = await touchDevice(admin, device);
        if (!device.first_contact_at) {
          await admin.from("device_events").insert({
            device_id: device.id,
            owner_id: device.owner_id,
            event_type: "first_contact",
            payload: {},
            source: "real",
          });
        }
        const { now, doses } = await todaysDoses(admin, device.owner_id, timezone, device.id);
        return json({
          server_time: ts,
          timezone,
          local_date: now.date,
          local_minutes: now.minutes,
          doses,
        });
      },
    },
  },
});
