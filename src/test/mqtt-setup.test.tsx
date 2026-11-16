import { EventEmitter } from "node:events";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import mqtt from "mqtt";

import { MqttSetup } from "@/components/mqtt-setup";
import { getMqttDue, forwardMqttSensor } from "@/lib/mqtt.functions";
import { MqttSessionProvider } from "@/lib/mqtt-session";

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
const due = (doses: (typeof dose)[]) => ({
  date,
  timezone: "Asia/Bangkok",
  minute: Math.floor(Date.now() / 60000),
  doses,
});

function fixture() {
  const socket = Object.assign(new EventEmitter(), {
    connected: false,
    connect: vi.fn(),
    end: vi.fn(),
    handleMessage: (
      _packet: { topic: string; retain: boolean; payload: Buffer },
      _done: () => void,
    ) => {},
    subscribe: vi.fn((_topic, _options, callback: (...args: unknown[]) => void) =>
      callback(null, [{ qos: 1 }]),
    ),
    publish: vi.fn((_topic, _payload, _options, callback: () => void) => callback()),
  });
  vi.mocked(mqtt.connect).mockReturnValue(socket as unknown as ReturnType<typeof mqtt.connect>);
  return socket;
}

function setupPage() {
  return <MqttSetup deviceId={deviceId} ownerId="owner" />;
}

function openSettings() {
  const details = screen.getByText("mqttSetup").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.mocked(getMqttDue).mockResolvedValue(due([]));
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

it("keeps MQTT on another CareBee page, sends the due dose once, and closes on page hide", async () => {
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
  await waitFor(() => expect(getMqttDue).toHaveBeenCalledTimes(1));
  expect(socket.publish).not.toHaveBeenCalled();

  screenTree.rerender(
    <MqttSessionProvider userId="owner">
      <p>Dashboard</p>
    </MqttSessionProvider>,
  );
  vi.mocked(getMqttDue).mockImplementation(async () => due([dose]));
  if (typeof tick !== "function") throw new Error("MQTT schedule timer did not start");
  act(() => {
    tick();
  });
  await waitFor(() => expect(socket.publish).toHaveBeenCalledTimes(1));
  const [topic, payload] = socket.publish.mock.calls[0]!;
  expect(topic).toBe("medicine/schedule/" + deviceId);
  expect(JSON.parse(payload)).toMatchObject({
    time: "16:00",
    compartment: 1,
    schedule_id: dose.schedule_id,
  });

  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(getMqttDue).toHaveBeenCalledTimes(3));
  expect(socket.publish).toHaveBeenCalledTimes(1);

  const secret = "smrb_" + "0".repeat(48);
  const message = JSON.stringify({ device_key: secret, status: { led: "on" } });
  const ack = vi.fn();
  vi.mocked(forwardMqttSensor).mockResolvedValue(true);
  socket.handleMessage(
    { topic: sensorTopic, retain: true, payload: Buffer.from(message) },
    vi.fn(),
  );
  expect(forwardMqttSensor).not.toHaveBeenCalled();
  socket.handleMessage({ topic: sensorTopic, retain: false, payload: Buffer.from(message) }, ack);
  await waitFor(() => expect(ack).toHaveBeenCalled());
  expect(forwardMqttSensor).toHaveBeenCalledWith({ data: { deviceId, message } });

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
