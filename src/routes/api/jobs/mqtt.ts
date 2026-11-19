import { createFileRoute } from "@tanstack/react-router";
import { runMqttJob } from "@/lib/mqtt-job.server";

export const Route = createFileRoute("/api/jobs/mqtt")({
  server: { handlers: { POST: async ({ request }) => runMqttJob(request) } },
});
