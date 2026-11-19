import { beforeEach, expect, it, vi } from "vitest";
import { runMqttJob } from "./mqtt-job.server";
import { mqttDefaults } from "./mqtt";

const state = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  publish: vi.fn(),
  open: vi.fn(),
  enabled: true,
  managedAuth: false,
  delivered: false,
  claimed: false,
}));
vi.mock("@/integrations/supabase/cron-auth", () => ({
  authenticateCronRequest: async () =>
    state.managedAuth ? null : new Response(null, { status: 500 }),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: state.from },
}));
vi.mock("./mqtt-background.server", async (original) => {
  const module = await original<typeof import("./mqtt-background.server")>();
  return { ...module, backgroundDb: () => ({ from: state.from, rpc: state.rpc }) };
});
vi.mock("./reminder-template.server", () => ({
  readSharedTemplate: async () => ({
    template: '{"id":"{{notification_id}}","channel":"{{compartment}}"}',
  }),
}));
vi.mock("./device-keys", () => ({
  hashDeviceKey: async (token: string) => (token === "valid" ? "abcd" : "0000"),
}));
vi.mock("./mqtt-publish.server", () => ({
  withMqttPublisher: (...args: unknown[]) => state.open(...args),
}));
vi.mock("./device-api", () => ({
  timeToMinutes: () => 1260,
  todaysDoses: async (_db: unknown, _owner: string, _timezone: string, _box: string, at: Date) => ({
    now: { date: at.toISOString().slice(0, 10), minutes: 1260 },
    doses: [0, 1].map((n) => ({
      schedule_id: "schedule-" + n,
      medicine_id: "medicine-" + n,
      device_id: "box",
      compartment: n + 1,
      time: "21:00",
      reminder: true,
      taken: false,
    })),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  state.enabled = true;
  state.managedAuth = false;
  state.delivered = false;
  state.claimed = false;
  state.open.mockImplementation(async (_settings, callback) => callback(state.publish));
  state.from.mockImplementation((table: string) => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({
        error: null,
        data:
          table === "mqtt_job_state"
            ? { token_hash: "abcd" }
            : table === "mqtt_background_configs"
              ? state.enabled
                ? { owner_id: "owner", settings: mqttDefaults }
                : null
              : table === "devices"
                ? { owner_id: "owner" }
                : { timezone: "Asia/Bangkok" },
      }),
      then: (resolve: (value: unknown) => void) => resolve({ error: null }),
    };
    return query;
  });
  state.rpc.mockImplementation(async (name, args) => {
    if (name === "mqtt_due_boxes")
      return { data: state.delivered ? [] : [{ device_id: "box" }], error: null };
    if (name === "claim_mqtt_delivery") {
      if (state.claimed || args._schedule_id === "schedule-1") return { data: [], error: null };
      state.claimed = true;
      return { data: [{ payload: args._payload }], error: null };
    }
    state.delivered = args._success;
    return { data: true, error: null };
  });
});

const request = (token?: string) =>
  new Request("https://carebee.invalid/api/jobs/mqtt", {
    method: "POST",
    headers: token ? { Authorization: "Bearer " + token } : {},
  });

it("rejects missing or wrong job credentials before connecting to the broker", async () => {
  expect((await runMqttJob(request())).status).toBe(401);
  expect((await runMqttJob(request("invalid"))).status).toBe(401);
  expect(state.open).not.toHaveBeenCalled();
  expect(state.rpc).not.toHaveBeenCalled();
});

it("publishes the shared template only for a claimed reminder and skips acknowledged work", async () => {
  expect((await runMqttJob(request("valid"))).status).toBe(200);
  expect(state.publish).toHaveBeenCalledTimes(1);
  expect(state.publish).toHaveBeenCalledWith(
    "medicine/schedule/box",
    expect.stringContaining('"channel":1'),
  );
  const payload = JSON.parse(state.publish.mock.calls[0]![1]);
  expect(payload.id).toMatch(/^box:\d{4}-\d{2}-\d{2}:schedule-0$/);
  expect(state.rpc).toHaveBeenCalledWith(
    "finish_mqtt_delivery",
    expect.objectContaining({ _success: true }),
  );
  expect((await runMqttJob(request("valid"))).status).toBe(200);
  expect(state.open).toHaveBeenCalledTimes(1);
});

it("rechecks that background reminders are still enabled before sending", async () => {
  state.enabled = false;
  expect((await runMqttJob(request("valid"))).status).toBe(200);
  expect(state.open).not.toHaveBeenCalled();
});

it("accepts a verified Lovable job without a separately configured database token", async () => {
  state.managedAuth = true;
  expect((await runMqttJob(request("lovable-managed-token"))).status).toBe(200);
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("returns promptly without MQTT when a managed tick has no due work", async () => {
  state.managedAuth = true;
  state.delivered = true;
  expect((await runMqttJob(request("lovable-managed-token"))).status).toBe(200);
  expect(state.open).not.toHaveBeenCalled();
});

it("keeps delivery alive after acknowledging a managed scheduler request", async () => {
  state.managedAuth = true;
  let task: Promise<unknown> | undefined;
  const response = await runMqttJob(request("lovable-managed-token"), (pending) => {
    task = pending;
  });
  expect(response.status).toBe(202);
  expect(task).toBeDefined();
  await task;
  expect(state.publish).toHaveBeenCalledTimes(1);
});

it("records a failed claim for retry when the broker does not acknowledge", async () => {
  state.publish.mockRejectedValue(new Error("connection lost"));
  expect((await runMqttJob(request("valid"))).status).toBe(502);
  expect(state.rpc).toHaveBeenCalledWith(
    "finish_mqtt_delivery",
    expect.objectContaining({ _success: false }),
  );
});
