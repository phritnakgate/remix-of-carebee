import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RtcProtocol } from "./rtc-protocol";
import { mqttDefaults } from "@/lib/mqtt";

const deviceId = "00000000-0000-4000-8000-000000000001";
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/queries", () => ({ useDevices: () => ({ data: [] }) }));
vi.mock("@/lib/rtc.functions", () => ({
  getRtcSchedule: async () => ({
    deviceId: "00000000-0000-4000-8000-000000000001",
    revision: "saved",
    channels: [{ compartment: 1, time: "09:45", days: [0, 1, 2, 3, 4, 5, 6] }],
  }),
}));

it("shows the saved time and full device-specific topics instead of a fixed example", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RtcProtocol deviceId={deviceId} ownerId="owner" settings={{ ...mqttDefaults, compartmentWeightsG: [2.35, null, null, null, null, null] }} open />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/"time": "09:45"/)).toBeInTheDocument();
  expect(screen.getByText(/"expectedDoseG": 2.35/)).toBeInTheDocument();
  expect(screen.getByText("medicine/schedule/" + deviceId)).toBeInTheDocument();
  expect(screen.getByText("medicine/sensor/" + deviceId)).toBeInTheDocument();
  expect(
    screen.getByText(/"deviceId": "00000000-0000-4000-8000-000000000001"/),
  ).toBeInTheDocument();
});
