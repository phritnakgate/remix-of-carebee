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

it("locks a box's broker settings while connected and allows a broker change after disconnect", async () => {
  const deviceId = "26a30a57-02d1-4e6e-9844-49824afc4d12";
  let connection: MqttConnection = {
    settings: mqttDefaults,
    enabled: false,
    state: "disconnected",
    failed: false,
  };
  const manage = vi.mocked(manageMqttConnection);
  let finishConnect: () => void = () => {};
  const connect = new Promise<void>((resolve) => {
    finishConnect = resolve;
  });
  manage.mockImplementation(async (options) => {
    const data = mqttCommandSchema.parse(options?.data);
    if (data.action === "connect") {
      await connect;
      connection = { ...connection, settings: data.settings, enabled: true, state: "connected" };
    }
    if (data.action === "disconnect") {
      connection = { ...connection, enabled: false, state: "disconnected" };
    }
    return { connection };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
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

  fireEvent.click(screen.getByRole("button", { name: "mqttDisconnect" }));
  await waitFor(() => expect(host).toBeEnabled());
  expect(screen.getByRole("status")).toHaveTextContent("mqttDisconnected");
  expect(host).toHaveValue("broker.example.com");
});
