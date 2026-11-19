import { createFileRoute } from "@tanstack/react-router";
import { runMqttJob } from "@/lib/mqtt-job.server";

export const Route = createFileRoute("/api/jobs/mqtt")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Nitro binds the Cloudflare execution context to the incoming request.
        const runtime = request as Request & { waitUntil?: (task: Promise<unknown>) => void };
        return runMqttJob(request, runtime.waitUntil);
      },
    },
  },
});
