import { createFileRoute } from "@tanstack/react-router";

import { preflight } from "@/lib/device-api";
import { receiveDeviceStatus } from "@/lib/device-status.server";

export const Route = createFileRoute("/api/public/device/status")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => receiveDeviceStatus(request),
    },
  },
});
