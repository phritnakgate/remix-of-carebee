import { expect, it } from "vitest";
import type { Medicine, Schedule } from "./medication";
import { rtcChannels, rtcMqttPayload } from "./rtc";

const boxId = "box-1";
const medicine = (id: string, dosage: string, pills: number, deviceId = boxId) =>
  ({ id, dosage, pills_per_dose: pills, device_id: deviceId, active: true }) as Medicine;

const schedule = (medicineId: string, days = [1, 3], notify = true) =>
  ({
    medicine_id: medicineId,
    box_slot: "morning_before",
    dose_time: "07:30:00",
    days_of_week: days,
    notify,
  }) as Schedule;

it("sums each scheduled medicine's strength in grams times the pills per dose", () => {
  const medicines = [
    medicine("a", "500 mg", 2),
    medicine("b", "0.25 กรัม", 1),
    medicine("c", "250 มก.", 2),
    medicine("d", "500 µg", 1),
    medicine("other-box", "1 g", 1, "box-2"),
  ];
  const rows = [
    schedule("a"),
    schedule("a", [3]),
    schedule("b", [1, 3], false),
    schedule("c"),
    schedule("d"),
    schedule("other-box"),
  ];
  const [channel] = rtcChannels(medicines, rows, boxId, "2026-11-26");
  expect(channel).toEqual({ compartment: 1, time: "07:30", days: [1, 3], expectedDoseG: 1.7505 });
  expect(rtcMqttPayload(channel!, null).expectedDoseG).toBe(1.7505);
  expect(rtcMqttPayload(channel!, 2.35).expectedDoseG).toBe(2.35);
});

it("omits an automatic weight when units are ambiguous or enabled days have different totals", () => {
  const [ambiguous] = rtcChannels(
    [medicine("a", "500 mg", 1), medicine("b", "5 mL", 1)],
    [schedule("a"), schedule("b")],
    boxId,
    "2026-11-26",
  );
  const [differentDays] = rtcChannels(
    [medicine("a", "500 mg", 1), medicine("b", "250 mg", 1)],
    [schedule("a"), schedule("b", [1])],
    boxId,
    "2026-11-26",
  );
  expect(rtcMqttPayload(ambiguous!)).not.toHaveProperty("expectedDoseG");
  expect(rtcMqttPayload(differentDays!)).not.toHaveProperty("expectedDoseG");
  expect(rtcMqttPayload({ ...differentDays!, time: null }, 1.5)).not.toHaveProperty("expectedDoseG");
});
