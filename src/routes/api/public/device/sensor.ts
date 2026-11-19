import { createFileRoute } from "@tanstack/react-router";
import { preflight } from "@/lib/device-api";
import { receiveMqttStatus } from "@/lib/device-status.server";

export const Route = createFileRoute("/api/public/device/sensor")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => receiveMqttStatus(request),
    },
  },
});
