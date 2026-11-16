import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { MqttSetup } from "@/components/mqtt-setup";
import { mqttCommandSchema, mqttDefaults, type MqttConnection } from "@/lib/mqtt";
import { manageMqttConnection } from "@/lib/mqtt.functions";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/mqtt.functions", () => ({ manageMqttConnection: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/queries", () => ({ useMedicines: () => ({ data: [], isPending: false }) }));

it("lets users fill in broker settings before status loads and when the bridge is unavailable", async () => {
  const manage = vi.mocked(manageMqttConnection);
  let finishStatus = () => {};
  const status = new Promise<void>((resolve) => {
    finishStatus = resolve;
  });
  manage.mockImplementation(async () => {
    await status;
    return { error: "unavailable" };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MqttSetup deviceId="26a30a57-02d1-4e6e-9844-49824afc4d12" ownerId="owner" />
    </QueryClientProvider>,
  );
  const details = screen.getByText("mqttSetup").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const host = screen.getByLabelText("mqttHost");
  expect(host).toBeEnabled();
  fireEvent.change(host, { target: { value: "broker.example.com" } });

  finishStatus();
  await screen.findByText("mqttUnavailable");
  expect(host).toBeEnabled();
  expect(host).toHaveValue("broker.example.com");
  expect(screen.getByRole("button", { name: "mqttConnect" })).toBeEnabled();
});

it("locks a box's broker settings while connected and allows a broker change after disconnect", async () => {
  const deviceId = "26a30a57-02d1-4e6e-9844-49824afc4d12";
  let connection: MqttConnection = {
    settings: mqttDefaults,
    enabled: false,
    state: "disconnected",
    failed: false,
  };
  const manage = vi.mocked(manageMqttConnection);
  let statusUnavailable = false;
  let finishConnect: () => void = () => {};
  const connect = new Promise<void>((resolve) => {
    finishConnect = resolve;
  });
  manage.mockImplementation(async (options) => {
    const data = mqttCommandSchema.parse(options?.data);
    if (data.action === "status" && statusUnavailable) return { error: "unavailable" };
    if (data.action === "connect") {
      await connect;
      connection = { ...connection, settings: data.settings, enabled: true, state: "connected" };
    }
    if (data.action === "disconnect") {
      connection = { ...connection, enabled: false, state: "disconnected" };
    }
    return { connection };
  });

  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <MqttSetup deviceId={deviceId} ownerId="owner" />
    </QueryClientProvider>,
  );
  const details = screen.getByText("mqttSetup").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const host = screen.getByLabelText("mqttHost");
  await waitFor(() => expect(host).toBeEnabled());
  expect(screen.getByText(`medicine/schedule/${deviceId}`)).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("mqttDisconnected");

  fireEvent.change(host, { target: { value: "broker.example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "mqttConnect" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("mqttConnecting"));
  expect(host).toBeDisabled();
  finishConnect();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("mqttConnected"));
  expect(host).toBeDisabled();
  expect(manage).toHaveBeenCalledWith({
    data: {
      action: "connect",
      deviceId,
      settings: { ...mqttDefaults, host: "broker.example.com" },
    },
  });

  statusUnavailable = true;
  void queryClient.invalidateQueries({ queryKey: ["mqtt-connection", deviceId] });
  await screen.findByText("mqttUnavailable");
  expect(host).toBeDisabled();
  statusUnavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "mqttDisconnect" }));
  await waitFor(() => expect(host).toBeEnabled());
  expect(screen.getByRole("status")).toHaveTextContent("mqttDisconnected");
  expect(host).toHaveValue("broker.example.com");
});
