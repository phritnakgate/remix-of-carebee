import { describe, expect, it } from "vitest";
import {
  deviceConnection,
  doseStatus,
  doseTargetsBox,
  expandDoses,
  isDueNow,
  scheduleCompartment,
  scheduleFood,
  type Medicine,
  type Schedule,
  type DoseLog,
} from "./medication";

const at = (h: number, m = 0) => new Date(2026, 10, 12, h, m); // Thu 12 Nov 2026

describe("dose status", () => {
  it("is pending until 60 minutes after the scheduled time", () => {
    expect(doseStatus(at(8), false, at(9, 0))).toBe("pending");
  });
  it("becomes missed more than 60 minutes after the scheduled time", () => {
    expect(doseStatus(at(8), false, at(9, 1))).toBe("missed");
  });
  it("is taken when a confirmation exists, even if late", () => {
    expect(doseStatus(at(8), true, at(23))).toBe("taken");
  });
  it("is due now from 30 minutes before the dose time", () => {
    expect(isDueNow(at(8), "pending", at(7, 30))).toBe(true);
    expect(isDueNow(at(8), "pending", at(7, 29))).toBe(false);
  });
});

describe("schedule expansion", () => {
  const med = { id: "m1", active: true } as Medicine;
  const base = {
    id: "s1",
    medicine_id: "m1",
    dose_time: "08:00:00",
    days_of_week: [4], // Thursday
    created_at: new Date(2026, 10, 1).toISOString(),
  } as Schedule;

  it("only creates doses on the scheduled weekdays", () => {
    const doses = expandDoses({
      dates: ["2026-11-12", "2026-11-13"],
      schedules: [base],
      medicines: [med],
      logs: [],
      now: at(12),
    });
    expect(doses.map((d) => d.date)).toEqual(["2026-11-12"]);
  });

  it("skips a dose whose time had passed when the schedule was created", () => {
    const doses = expandDoses({
      dates: ["2026-11-12"],
      schedules: [{ ...base, created_at: at(10).toISOString() }],
      medicines: [med],
      logs: [],
      now: at(12),
    });
    expect(doses).toHaveLength(0);
  });

  it("marks a dose taken when it has a confirmation for that date", () => {
    const log = { schedule_id: "s1", scheduled_date: "2026-11-12" } as DoseLog;
    const doses = expandDoses({
      dates: ["2026-11-12"],
      schedules: [base],
      medicines: [med],
      logs: [log],
      now: at(12),
    });
    expect(doses[0]?.status).toBe("taken");
  });

  it("keeps recorded doses when a round is retired without adding new pending doses", () => {
    const retired = { ...base, ends_on: "2026-11-12" };
    const args = { dates: ["2026-11-12"], schedules: [retired], medicines: [med], now: at(12) };
    expect(expandDoses({ ...args, logs: [] })).toHaveLength(0);
    const log = { schedule_id: "s1", scheduled_date: "2026-11-12" } as DoseLog;
    expect(expandDoses({ ...args, logs: [log] })[0]?.status).toBe("taken");
  });

  it("routes the same medicine's two evening rounds to different compartments of its one box", () => {
    const medicine = { ...med, device_id: "box-1", compartment: 2 };
    const before = { ...base, box_slot: "evening_before" } as const;
    const after = { ...base, box_slot: "evening_after" } as const;
    expect(doseTargetsBox(before, medicine, "box-1")).toBe(true);
    expect(doseTargetsBox(after, medicine, "box-2")).toBe(false);
    expect(doseTargetsBox(after, { ...medicine, device_id: null }, "box-2")).toBe(false);
    expect(doseTargetsBox(base, med, "box-2")).toBe(true);
    expect([scheduleCompartment(before, medicine), scheduleCompartment(after, medicine)]).toEqual([5, 6]);
    expect([scheduleFood(before, medicine), scheduleFood(after, medicine)]).toEqual(["before_food", "after_food"]);
  });
});

describe("hardware connection", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  it("never treats a simulated device as connected hardware", () => {
    expect(deviceConnection({ mode: "simulated", first_contact_at: now.toISOString(), last_seen_at: now.toISOString() }, now)).toBe("simulated");
  });
  it("waits for first contact before a real device can be online", () => {
    expect(deviceConnection({ mode: "real", first_contact_at: null, last_seen_at: null }, now)).toBe("awaiting_first_contact");
  });
  it("is online only if the device reported within 2 minutes", () => {
    const seen = (s: number) => new Date(now.getTime() - s * 1000).toISOString();
    expect(deviceConnection({ mode: "real", first_contact_at: seen(999), last_seen_at: seen(120) }, now)).toBe("online");
    expect(deviceConnection({ mode: "real", first_contact_at: seen(999), last_seen_at: seen(121) }, now)).toBe("offline");
  });
});
