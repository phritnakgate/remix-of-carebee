import { createFileRoute } from "@tanstack/react-router";

import { preflight } from "@/lib/device-api";
import { confirmDeviceDose } from "@/lib/device-confirm.server";

export const Route = createFileRoute("/api/public/device/confirm")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      POST: async ({ request }) => confirmDeviceDose(request),
    },
  },
});
