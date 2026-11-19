import { beforeEach, expect, it, vi } from "vitest";

import { receiveDeviceStatus, receiveMqttStatus } from "./device-status.server";
import { readSharedTemplate } from "./reminder-template.server";
import type { DeviceStatusPayload } from "./medication";

const db = vi.hoisted(() => ({
  state: { led: "on" } as DeviceStatusPayload,
  firstContact: "2026-11-16T00:00:00Z",
  addEvent: vi.fn(),
  write: vi.fn(),
}));

vi.mock("./device-api", () => ({
  json: (data: unknown, status = 200) => Response.json(data, { status }),
  authenticateDevice: () => ({
    device: {
      id: "box-a",
      owner_id: "owner-a",
      last_status: db.state,
      first_contact_at: db.firstContact,
    },
    admin: {
      from: (table: string) =>
        table === "device_events" ? { insert: db.addEvent } : { update: db.write },
    },
  }),
}));
vi.mock("./reminder-template.server", () => ({ readSharedTemplate: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  db.state = { led: "on" };
  vi.mocked(readSharedTemplate).mockResolvedValue({ available: false, template: "" });
  db.write.mockImplementation(({ last_status }: { last_status: DeviceStatusPayload }) => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      filter: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: async () => {
        db.state = last_status;
        return { data: { id: "box-a" }, error: null };
      },
    };
    return query;
  });
});

const request = (payload: unknown) =>
  new Request("https://carebee.invalid/device", {
    method: "POST",
    body: JSON.stringify(payload),
  });

const report = (compartment: number, weight_g: number) =>
  receiveMqttStatus(request({ type: "load_cell", compartment, weight_g }), "box-a");

it("stores readings per compartment and logs only changes beyond the threshold", async () => {
  expect((await report(1, 12.4)).ok).toBe(true);
  expect((await report(2, 30)).ok).toBe(true);
  expect((await report(1, 12.2)).ok).toBe(true);
  expect(db.addEvent).not.toHaveBeenCalled();
  expect((await report(1, 11.9)).ok).toBe(true);
  expect((await report(1, 11.9)).ok).toBe(true);
  expect(db.state).toMatchObject({
    led: "on",
    load_cells: {
      1: { weight_g: 11.9, last_change: "decreased" },
      2: { weight_g: 30 },
    },
  });
  expect(db.addEvent).toHaveBeenCalledExactlyOnceWith({
    device_id: "box-a",
    owner_id: "owner-a",
    event_type: "status_changed",
    source: "real",
    payload: { compartment: 1, weight_g: 11.9, delta_g: -0.5, direction: "decreased" },
  });
  await receiveDeviceStatus(request({ led: "off" }), "box-a");
  expect(db.state).toMatchObject({ led: "off", load_cells: { 1: { weight_g: 11.9 } } });
  expect(
    (await receiveMqttStatus(request({ status: { led: "on" } }), "box-a", { led: "on" })).ok,
  ).toBe(true);
  expect(db.state).toMatchObject({ led: "on", load_cells: { 1: { weight_g: 11.9 } } });
});

it("uses different JSON paths and an administrator-defined threshold", async () => {
  vi.mocked(readSharedTemplate).mockResolvedValue({
    available: true,
    template: JSON.stringify({
      eventPath: "status.event",
      eventValue: "measurement",
      compartmentPath: "status.reading.channel",
      weightPath: "status.reading.grams",
      thresholdGrams: 2,
    }),
  });
  const event = (grams: number) => {
    const status = { event: "measurement", reading: { channel: 7, grams } };
    return receiveMqttStatus(request({ status }), "box-a", status);
  };
  expect((await event(10)).ok).toBe(true);
  expect((await event(10.7)).ok).toBe(true);
  expect(db.addEvent).not.toHaveBeenCalled();
  expect((await event(12)).ok).toBe(true);
  expect(db.state.load_cells?.["7"]?.last_change).toBe("increased");
});

it("rejects a mismatched box or an invalid compartment without writing status", async () => {
  const payload = { type: "load_cell", compartment: 1, weight_g: 12.4 };
  expect((await receiveMqttStatus(request(payload), "box-b")).status).toBe(403);
  expect((await report(8, 11)).status).toBe(400);
  expect(db.write).not.toHaveBeenCalled();
});

it("accepts an API sensor report without a browser-supplied box ID", async () => {
  expect(
    (await receiveMqttStatus(request({ type: "load_cell", compartment: 1, weight_g: 12.4 }))).ok,
  ).toBe(true);
  expect(db.state.load_cells?.["1"]?.weight_g).toBe(12.4);
  const invalid = new Request("https://carebee.invalid/device/sensor", {
    method: "POST",
    body: "{",
  });
  expect((await receiveMqttStatus(invalid)).status).toBe(400);
});

it("accepts a single load cell for the whole box when configured", async () => {
  vi.mocked(readSharedTemplate).mockResolvedValue({
    available: true,
    template: JSON.stringify({
      eventPath: "type",
      eventValue: "load_cell",
      compartmentPath: null,
      weightPath: "weight_g",
      thresholdGrams: 0.5,
    }),
  });
  for (const weight_g of [12.4, 11.6]) {
    expect((await receiveMqttStatus(request({ type: "load_cell", weight_g }), "box-a")).ok).toBe(
      true,
    );
  }
  expect(db.state.load_cells?.["box"]).toMatchObject({ weight_g: 11.6, last_change: "decreased" });
  expect(db.addEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: { compartment: null, weight_g: 11.6, delta_g: -0.8, direction: "decreased" },
    }),
  );
});
