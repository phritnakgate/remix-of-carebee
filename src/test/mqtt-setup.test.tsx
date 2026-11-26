import { EventEmitter } from "node:events";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import mqtt from "mqtt";

import { ConnectionPill } from "@/components/hardware-status";
import { MqttSetup } from "@/components/mqtt-setup";
import { mqttTestPayload } from "@/lib/mqtt";
import { getMqttDue, forwardMqttSensor } from "@/lib/mqtt.functions";
import { MqttSessionProvider, useMqttSession } from "@/lib/mqtt-session";
import { scheduledReminderPayload } from "@/lib/reminder-template";
import { mqttDefaults } from "@/lib/mqtt";
import { getRtcSchedule } from "@/lib/rtc.functions";
vi.mock("@/lib/rtc.functions", () => ({ getRtcSchedule: vi.fn() }));

vi.mock("@/components/rtc-protocol", () => ({ RtcProtocol: () => null }));

const { queryClient, rtcConfig } = vi.hoisted(() => ({
  queryClient: { invalidateQueries: vi.fn() },
  rtcConfig: { data: undefined as Awaited<ReturnType<typeof getRtcSchedule>> | undefined },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
  useQuery: () => rtcConfig,
}));

vi.mock("@tanstack/react-start", () => ({
  createClientOnlyFn: (fn: unknown) => fn,
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/mqtt.functions", () => ({ getMqttDue: vi.fn(), forwardMqttSensor: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/queries", () => {
  const devices = [{ id: "26a30a57-02d1-4e6e-9844-49824afc4d12", mode: "real" }];
  return {
    useMedicines: () => ({ data: [], isPending: false }),
    useDevices: () => ({ data: devices }),
  };
});
vi.mock("mqtt", () => ({ default: { connect: vi.fn() } }));

const deviceId = "26a30a57-02d1-4e6e-9844-49824afc4d12";
const sensorTopic = "medicine/sensor/" + deviceId;
const date = "2026-11-16";
const dose = {
  schedule_id: "77d23b38-6a60-4b24-b9f3-549c38a931a2",
  medicine_id: "77d23b38-6a60-4b24-b9f3-549c38a931a3",
  medicine: "Demo",
  dosage: "1",
  pills: 1,
  food_instruction: "before_food" as const,
  compartment: 1,
  slot: "evening" as const,
  time: "16:00",
  reminder: true,
  taken: false,
  confirmed_at: null,
};
const due = (doses: (typeof dose)[], reminderTemplate = "") => ({
  date,
  timezone: "Asia/Bangkok",
  minute: Math.floor(Date.now() / 60000),
  doses,
  reminderTemplate,
});

it("uses existing box payload settings when a shared template is missing or invalid", () => {
  const message = { compartment: 1 };
  expect(scheduledReminderPayload(message, "", '{"channel":"{{compartment}}"}', "legacy")).toBe(
    '{"channel":1}',
  );
  expect(scheduledReminderPayload(message, '{"v":"{{unknown}}"}', "", "legacy")).toBe("legacy");
  expect(scheduledReminderPayload(message, "", "", "")).toBe('{"compartment":1}');
});

function fixture() {
  const socket = Object.assign(new EventEmitter(), {
    connected: false,
    connect: vi.fn(),
    end: vi.fn(),
    subscribe: vi.fn((_topic, _options, callback: (...args: unknown[]) => void) =>
      callback(null, [{ qos: 1 }]),
    ),
    publish: vi.fn((_topic, _payload, _options, callback: () => void) => callback()),
  });
  vi.mocked(mqtt.connect).mockReturnValue(socket as unknown as ReturnType<typeof mqtt.connect>);
  return socket;
}

function TestDevicePage() {
  const { testContacts } = useMqttSession();
  return (
    <>
      <ConnectionPill
        conn="awaiting_first_contact"
        testReceived={testContacts[deviceId] === true}
      />
      <MqttSetup deviceId={deviceId} ownerId="owner" />
    </>
  );
}

function setupPage() {
  return <TestDevicePage />;
}

function openSettings() {
  const details = screen.getByText("mqttSetup").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

beforeEach(() => {
  vi.resetAllMocks();
  rtcConfig.data = undefined;
  localStorage.clear();
  localStorage.setItem("carebee-mqtt:" + deviceId, JSON.stringify({
    settings: { ...mqttDefaults, rtc: false }, enabled: false,
  }));
  vi.mocked(getMqttDue).mockResolvedValue(due([]));
  vi.mocked(getRtcSchedule).mockResolvedValue({
    deviceId, timezone: "Asia/Bangkok", revision: "empty", channels: [],
  });
});

it("sends six saved RTC channels and resends changed or disabled times after a save", async () => {
  const socket = fixture();
  const channels = ([1,2,3,4,5,6] as const).map((compartment) => ({
    compartment, time: compartment === 1 ? "07:30" : null,
    days: compartment === 1 ? [0,1,2,3,4,5,6] : [],
  }));
  vi.mocked(getRtcSchedule).mockResolvedValue({
    deviceId, timezone: "Asia/Bangkok", revision: "test-revision", channels,
  });
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  socket.connected = true;
  act(() => { socket.emit("connect"); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(6));
  expect(socket.publish.mock.calls[0]?.slice(0, 2)).toEqual([
    "medicine/schedule/" + deviceId, '{"compartment":1,"time":"07:30"}',
  ]);
  expect(getMqttDue).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("carebee-mqtt:" + deviceId)!).settings.rtc).toBe(true);
  expect(screen.queryByText("mqttPayload")).not.toBeInTheDocument();
  expect(screen.queryByText("mqttBackgroundTitle")).not.toBeInTheDocument();
  vi.mocked(getRtcSchedule).mockResolvedValue({
    deviceId, timezone: "Asia/Bangkok", revision: "changed",
    channels: channels.map((channel) => ({ ...channel, time: null, days: [] })),
  });
  act(() => { window.dispatchEvent(new Event("carebee-schedule-changed")); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(12));
  expect(JSON.parse(socket.publish.mock.calls[6]![1])).toMatchObject({ compartment: 1, time: null });
});

it("unlocks broker settings if opening the MQTT transport throws before a stream exists", async () => {
  const socket = fixture();
  socket.connect.mockImplementationOnce(() => {
    throw new Error("WebSocket construction failed");
  });
  socket.end.mockImplementationOnce(() => {
    throw new TypeError("Cannot read properties of undefined (reading 'on')");
  });
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await screen.findByText("mqttConnectionFailed");
  expect(socket.end).not.toHaveBeenCalled();
  expect(screen.getByLabelText("mqttHost")).toBeEnabled();
  expect(screen.getByRole("button", { name: "mqttConnect" })).toBeEnabled();
});

it("closes the native WebSocket and unlocks settings even if MQTT.js end throws", async () => {
  const socket = fixture();
  const closeTransport = vi.fn();
  vi.stubGlobal(
    "WebSocket",
    class {
      static CLOSING = 2;
      readyState = 1;
      close = closeTransport;
    },
  );
  try {
    socket.connect.mockImplementationOnce(() => {
      const options = vi.mocked(mqtt.connect).mock.calls[0]?.[1];
      if (!options?.createWebsocket) throw new Error("Missing WebSocket factory");
      options.createWebsocket("wss://broker.hivemq.com:8884/mqtt", ["mqtt"], options);
    });
    socket.end.mockImplementationOnce(() => {
      throw new Error("MQTT.js could not close its stream");
    });
    render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
    openSettings();
    fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
    await waitFor(() => expect(socket.connect).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "mqttDisconnect" }));
    expect(socket.end).toHaveBeenCalledWith(true);
    expect(closeTransport).toHaveBeenCalled();
    expect(screen.getByLabelText("mqttHost")).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("mqttDisconnected");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("connects directly over WSS and locks settings through connection until Disconnect", async () => {
  const socket = fixture();
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  const host = screen.getByLabelText("mqttHost");
  expect(host).toBeEnabled();
  expect(host).toHaveValue("broker.hivemq.com");
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  expect(host).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("mqttConnecting");
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  expect(mqtt.connect).toHaveBeenCalledWith(
    "wss://broker.hivemq.com:8884/mqtt",
    expect.any(Object),
  );

  socket.connected = true;
  act(() => {
    socket.emit("connect");
  });
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("mqttConnected"));
  expect(socket.subscribe).toHaveBeenCalledWith(sensorTopic, { qos: 1 }, expect.any(Function));
  expect(host).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "mqttDisconnect" }));
  expect(host).toBeEnabled();
  expect(socket.end).toHaveBeenCalledWith(true);
  expect(screen.getByRole("status")).toHaveTextContent("mqttDisconnected");
});

it("uses the EMQX WSS preset and waits for a manual Connect after the socket closes", async () => {
  const socket = fixture();
  const page = <MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>;
  const view = render(page);
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "EMQX Public" }));
  expect(screen.getByLabelText("mqttHost")).toHaveValue("broker.emqx.io");
  expect(screen.getByLabelText("mqttTlsWsPort")).toHaveValue(8084);
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
  expect(mqtt.connect).toHaveBeenCalledWith("wss://broker.emqx.io:8084/mqtt", expect.any(Object));

  socket.connected = true;
  act(() => {
    socket.emit("connect");
  });
  socket.publish.mockImplementationOnce(() => {});
  vi.useFakeTimers();
  try {
    fireEvent.click(screen.getByRole("button", { name: "mqttTestPublish" }));
    expect(screen.getByText("mqttMessageSending")).toBeInTheDocument();
    await act(async () => {
      socket.emit("close");
    });
    expect(screen.getByText("mqttConnectionFailed")).toBeInTheDocument();
    expect(screen.getByText("mqttMessageSendFailed")).toBeInTheDocument();
    expect(screen.getByLabelText("mqttHost")).toBeEnabled();
    expect(screen.getByRole("button", { name: "mqttConnect" })).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(mqtt.connect).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
  view.unmount();
  render(page);
  expect(mqtt.connect).toHaveBeenCalledTimes(1);
});

it("closes the socket when the user disconnects the same box in another tab", async () => {
  const socket = fixture();
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
  const key = `carebee-mqtt:${deviceId}`;
  const saved = JSON.parse(localStorage.getItem(key)!);
  const newValue = JSON.stringify({ ...saved, enabled: false });
  localStorage.setItem(key, newValue);
  fireEvent(window, new StorageEvent("storage", { key, newValue }));
  expect(socket.end).toHaveBeenCalledWith(true);
  expect(screen.getByRole("button", { name: "mqttConnect" })).toBeEnabled();
  expect(screen.getByLabelText("mqttHost")).toBeEnabled();
});

it("sends a manual payload to the configured outgoing topic and displays the incoming MQTTX test", async () => {
  const socket = fixture();
  let acknowledge = () => {};
  socket.publish.mockImplementationOnce((_topic, _payload, _options, callback) => {
    acknowledge = callback;
  });
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  const monitor = within(screen.getByRole("region", { name: "mqttTraffic" }));
  const testPublish = monitor.getByRole("button", { name: "mqttTestPublish" });
  expect(testPublish).toBeDisabled();
  fireEvent.change(screen.getByLabelText("mqttScheduleTopic"), { target: { value: "demo/out" } });
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  socket.connected = true;
  act(() => {
    socket.emit("connect");
  });
  await waitFor(() => expect(testPublish).toBeEnabled());

  const payload = "  demo from the website  ";
  fireEvent.change(monitor.getByLabelText("mqttTestPayload"), { target: { value: payload } });
  fireEvent.click(testPublish);
  expect(socket.publish).toHaveBeenCalledTimes(1);
  expect(socket.publish).toHaveBeenCalledWith(
    `demo/out/${deviceId}`,
    payload,
    { qos: 1, retain: false },
    expect.any(Function),
  );
  const outgoing = within(monitor.getByRole("list", { name: "mqttOutgoing" }));
  expect(outgoing.getByText("mqttTestMessage")).toBeInTheDocument();
  expect(outgoing.getByText("mqttMessageSending")).toBeInTheDocument();
  expect(testPublish).toBeDisabled();
  act(() => {
    acknowledge();
  });
  await outgoing.findByText("mqttMessageAcknowledged");

  act(() => {
    socket.emit("message", sensorTopic, Buffer.from(mqttTestPayload), { retain: false });
  });
  const incoming = within(monitor.getByRole("list", { name: "mqttIncoming" }));
  expect(incoming.getByText("mqttTestMessage")).toBeInTheDocument();
  expect(incoming.getByText("mqttMessageReceived")).toBeInTheDocument();
  expect(incoming.getByText(/Hello from CareBee/)).toBeInTheDocument();
  expect(screen.getByText("hwMqttTestReceived")).toBeInTheDocument();
  expect(screen.queryByText("hwAwaiting")).not.toBeInTheDocument();
  expect(forwardMqttSensor).not.toHaveBeenCalled();
  expect(queryClient.invalidateQueries).not.toHaveBeenCalled();

  let finishReport = (_accepted: boolean) => {};
  vi.mocked(forwardMqttSensor).mockReturnValue(
    new Promise<boolean>((resolve) => {
      finishReport = resolve;
    }),
  );
  act(() => {
    socket.emit("message", sensorTopic, Buffer.from('{"status":{"led":"on"}}'), { retain: false });
  });
  await waitFor(() => expect(forwardMqttSensor).toHaveBeenCalledTimes(1));
  fireEvent.click(testPublish);
  await waitFor(() => expect(outgoing.getAllByText("mqttMessageAcknowledged")).toHaveLength(2));
  await act(async () => {
    finishReport(true);
  });
  expect(incoming.getByText("mqttMessageProcessed")).toBeInTheDocument();
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["devices", "owner"] });
  expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["device_events", "owner"],
  });
});

it("keeps MQTT on another CareBee page, syncs RTC changes once, and closes on page hide", async () => {
  const socket = fixture();
  const interval = vi.spyOn(window, "setInterval");
  const screenTree = render(
    <MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>,
  );
  const tick = interval.mock.calls.find(([, delay]) => delay === 5000)?.[0];
  interval.mockRestore();
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  socket.connected = true;
  act(() => {
    socket.emit("connect");
  });
  await waitFor(() => expect(getRtcSchedule).toHaveBeenCalledTimes(1));
  expect(socket.publish).not.toHaveBeenCalled();

  screenTree.rerender(
    <MqttSessionProvider userId="owner">
      <p>Dashboard</p>
    </MqttSessionProvider>,
  );
  vi.mocked(getRtcSchedule).mockResolvedValue({
    deviceId, timezone: "Asia/Bangkok", revision: "changed",
    channels: [{ compartment: 1, time: "16:00", days: [0,1,2,3,4,5,6] }],
  });
  if (typeof tick !== "function") throw new Error("MQTT schedule timer did not start");
  act(() => {
    tick();
  });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(1));
  const [topic, payload] = socket.publish.mock.calls[0]!;
  expect(topic).toBe("medicine/schedule/" + deviceId);
  expect(JSON.parse(payload)).toEqual({
    time: "16:00",
    compartment: 1,
  });

  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(getRtcSchedule).toHaveBeenCalledTimes(3));
  expect(socket.publish).toHaveBeenCalledTimes(1);

  const secret = "smrb_" + "0".repeat(48);
  const message = JSON.stringify({ device_key: secret, status: { led: "on" } });
  vi.mocked(forwardMqttSensor).mockResolvedValue(true);
  act(() => {
    socket.emit("message", sensorTopic, Buffer.from(message), { retain: true });
  });
  expect(forwardMqttSensor).not.toHaveBeenCalled();
  act(() => {
    socket.emit("message", sensorTopic, Buffer.from(message), { retain: false });
  });
  await waitFor(() =>
    expect(forwardMqttSensor).toHaveBeenCalledWith({
      data: { deviceId, message },
      signal: expect.any(AbortSignal),
    }),
  );

  screenTree.rerender(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  const monitor = within(screen.getByRole("region", { name: "mqttTraffic" }));
  const incoming = within(monitor.getByRole("list", { name: "mqttIncoming" }));
  expect(incoming.getByText("mqttMessageProcessed")).toBeInTheDocument();
  expect(incoming.getByText("mqttMessageRetained")).toBeInTheDocument();
  expect(incoming.getAllByText(/••••/)).toHaveLength(2);
  expect(incoming.queryByText(new RegExp(secret))).not.toBeInTheDocument();
  const outgoing = within(monitor.getByRole("list", { name: "mqttOutgoing" }));
  expect(outgoing.getByText("mqttMessageAcknowledged")).toBeInTheDocument();
  expect(outgoing.getByText(/16:00/)).toBeInTheDocument();

  fireEvent.click(monitor.getByRole("button", { name: "mqttClearTraffic" }));
  expect(monitor.getByText("mqttIncomingEmpty")).toBeInTheDocument();
  expect(monitor.getByText("mqttOutgoingEmpty")).toBeInTheDocument();
  expect(socket.end).not.toHaveBeenCalled();
  fireEvent(window, new Event("pagehide"));
  expect(socket.end).toHaveBeenCalledWith(true);
});

it("restores the connection when reopening CareBee until the user disconnects", async () => {
  const socket = fixture();
  const page = <MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>;
  const first = render(page);
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalledTimes(1));
  first.unmount();
  expect(socket.end).toHaveBeenCalledWith(true);

  const next = fixture();
  const reopened = render(page);
  await waitFor(() => expect(next.connect).toHaveBeenCalledTimes(1));
  openSettings();
  fireEvent.click(screen.getByRole("button", { name: "mqttDisconnect" }));
  reopened.unmount();

  vi.mocked(mqtt.connect).mockClear();
  render(page);
  openSettings();
  expect(screen.getByLabelText("mqttHost")).toBeEnabled();
  expect(mqtt.connect).not.toHaveBeenCalled();
});

it("publishes a decimal dose weight and acknowledges a saved partial intake", async () => {
  const socket = fixture();
  vi.mocked(getRtcSchedule).mockResolvedValue({
    deviceId, timezone: "Asia/Bangkok", revision: "weighted",
    channels: [{ compartment: 1, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] }],
  });
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  fireEvent.change(screen.getByLabelText("compartment 1"), { target: { value: "2.35" } });
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  socket.connected = true;
  act(() => { socket.emit("connect"); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(1));
  expect(JSON.parse(socket.publish.mock.calls[0]![1])).toEqual({
    compartment: 1, time: "07:30", expectedDoseG: 2.35,
  });
  vi.mocked(forwardMqttSensor).mockResolvedValue(true);
  const message = JSON.stringify({
    type: "intake_partial", deviceId, device_key: "smrb_" + "0".repeat(48),
    compartment: 1, scheduledDate: date, removedWeightG: 1.25,
  });
  act(() => { socket.emit("message", sensorTopic, Buffer.from(message), { retain: false }); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(2));
  expect(JSON.parse(socket.publish.mock.calls[1]![1])).toEqual({
    type: "intake_ack", compartment: 1, outcome: "partial", scheduledDate: date,
  });
});

it("uses the calculated dose weight by default and republishes when it changes", async () => {
  const socket = fixture();
  const config = (expectedDoseG: number) => ({
    deviceId,
    timezone: "Asia/Bangkok",
    revision: "same-timing",
    channels: [{ compartment: 1, time: "07:30", days: [1, 3], expectedDoseG }],
  });
  rtcConfig.data = config(1.75);
  vi.mocked(getRtcSchedule).mockResolvedValue(config(1.75));
  render(<MqttSessionProvider userId="owner">{setupPage()}</MqttSessionProvider>);
  openSettings();
  expect(screen.getByLabelText("compartment 1")).toHaveAttribute("placeholder", "1.75");
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(socket.connect).toHaveBeenCalled());
  socket.connected = true;
  act(() => { socket.emit("connect"); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(1));
  expect(JSON.parse(socket.publish.mock.calls[0]![1]).expectedDoseG).toBe(1.75);

  vi.mocked(getRtcSchedule).mockResolvedValue(config(2.25));
  act(() => { window.dispatchEvent(new Event("carebee-schedule-changed")); });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(2));
  expect(JSON.parse(socket.publish.mock.calls[1]![1]).expectedDoseG).toBe(2.25);
});
