import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { MqttTrafficPanel } from "@/components/mqtt-traffic";
import { RtcProtocol } from "@/components/rtc-protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import {
  boxTopic,
  mqttBrokerUrl,
  mqttDefaults,
  mqttPublicBrokers,
  mqttSettingsSchema,
  type MqttSettings,
} from "@/lib/mqtt";
import { readMqttSettings, useMqttSession } from "@/lib/mqtt-session";
import { getRtcSchedule } from "@/lib/rtc.functions";
import { RTC_CHANNELS } from "@/lib/rtc";
import { cn } from "@/lib/utils";

const states = {
  disconnected: {
    label: "mqttDisconnected",
    tone: "bg-missed-soft text-missed-foreground",
    dot: "bg-red-600",
  },
  connecting: {
    label: "mqttConnecting",
    tone: "bg-pending-soft text-pending-foreground",
    dot: "bg-yellow-500",
  },
  connected: {
    label: "mqttConnected",
    tone: "bg-taken-soft text-taken-foreground",
    dot: "bg-green-600",
  },
} as const;

export function MqttSetup({ deviceId, ownerId }: { deviceId: string; ownerId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const { data: rtcConfig } = useQuery({
    queryKey: ["rtc-config", deviceId],
    queryFn: () => getRtcSchedule({ data: { deviceId } }),
    enabled: open,
    staleTime: 5_000,
    refetchInterval: open ? 5_000 : false,
    retry: false,
  });
  const [draft, setDraft] = useState(() => ({
    ...(readMqttSettings(deviceId) ?? mqttDefaults),
    rtc: true,
  }));
  const { connections, traffic, clearTraffic, publishTest, connect, disconnect } = useMqttSession();
  const connection = connections[deviceId];
  const locked = !!connection && connection.state !== "disconnected";
  const settings = locked ? connection.settings : draft;
  const indicator = states[connection?.state ?? "disconnected"];
  const field = (name: string) => `${deviceId}-mqtt-${name}`;
  const patch = (values: Partial<MqttSettings>) => setDraft({ ...settings, ...values });

  return (
    <details
      className="mt-6 rounded-2xl border bg-card p-4 sm:p-5"
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-lg font-bold">{t("mqttSetup")}</summary>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold",
            indicator.tone,
          )}
        >
          <span aria-hidden className={cn("size-2.5 rounded-full", indicator.dot)} />
          {t(indicator.label)}
        </span>
        {connection?.failed && (
          <span className="text-sm text-muted-foreground">{t("mqttConnectionFailed")}</span>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{t("rtcModeHint")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("mqttPublicBrokerHint")}</p>

      <MqttTrafficPanel
        deviceId={deviceId}
        logs={traffic[deviceId]}
        topics={{
          incoming: boxTopic(settings.sensorTopic.trim(), deviceId),
          outgoing: boxTopic(settings.scheduleTopic.trim(), deviceId),
        }}
        connected={connection?.state === "connected"}
        onClear={() => clearTraffic(deviceId)}
        onTestPublish={(payload) => publishTest(deviceId, payload)}
      />

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          const parsed = mqttSettingsSchema.safeParse({ ...settings, rtc: true });
          if (!parsed.success) {
            toast.error(t("mqttInvalidSettings"));
            return;
          }
          setDraft(parsed.data);
          connect(deviceId, parsed.data);
        }}
      >
        <fieldset disabled={locked} className="space-y-5 disabled:opacity-70">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch(mqttPublicBrokers.emqx)}
            >
              EMQX Public
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch(mqttPublicBrokers.hiveMq)}
            >
              HiveMQ Public
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={field("host")}>{t("mqttHost")}</Label>
              <Input
                id={field("host")}
                value={settings.host}
                onChange={(event) => patch({ host: event.target.value })}
                placeholder="broker.example.com"
                required
                maxLength={253}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={field("port")}>{t("mqttTlsWsPort")}</Label>
              <Input
                id={field("port")}
                required
                type="number"
                min={1}
                max={65535}
                value={settings.websocketPort || ""}
                onChange={(event) => patch({ websocketPort: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={field("path")}>{t("mqttWsPath")}</Label>
              <Input
                id={field("path")}
                value={settings.websocketPath}
                onChange={(event) => patch({ websocketPath: event.target.value })}
                required
                maxLength={200}
              />
              <code className="block break-all text-xs text-muted-foreground">
                {mqttBrokerUrl(settings)}
              </code>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={field("sensor")}>{t("mqttSensorTopic")}</Label>
              <Input
                id={field("sensor")}
                value={settings.sensorTopic}
                maxLength={200}
                onChange={(event) => patch({ sensorTopic: event.target.value })}
                required
              />
              <code className="block break-all text-xs text-muted-foreground">
                {boxTopic(settings.sensorTopic.trim(), deviceId)}
              </code>
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor={field("schedule")}>{t("mqttScheduleTopic")}</Label>
              <Input
                id={field("schedule")}
                value={settings.scheduleTopic}
                maxLength={200}
                onChange={(event) => patch({ scheduleTopic: event.target.value })}
                required
              />
              <code className="block break-all text-xs text-muted-foreground">
                {boxTopic(settings.scheduleTopic.trim(), deviceId)}
              </code>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("mqttDoseWeights")}</p>
            <p className="text-sm text-muted-foreground">{t("mqttDoseWeightsHint")}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RTC_CHANNELS.map((compartment) => (
                <div key={compartment}>
                  <Label htmlFor={field(`dose-weight-${compartment}`)}>{t("compartment")} {compartment}</Label>
                  <Input
                    id={field(`dose-weight-${compartment}`)}
                    type="number"
                    step="any"
                    min={0.001}
                    max={10000}
                    placeholder={rtcConfig?.channels.find((channel) => channel.compartment === compartment)?.expectedDoseG?.toString()}
                    value={settings.compartmentWeightsG?.[compartment - 1] ?? ""}
                    onChange={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      patch({
                        compartmentWeightsG: RTC_CHANNELS.map((number) =>
                          number === compartment ? (Number.isFinite(value) ? value : null) :
                            settings.compartmentWeightsG?.[number - 1] ?? null,
                        ),
                      });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </fieldset>

        {locked ? (
          <Button type="button" variant="outline" onClick={() => disconnect(deviceId)}>
            {t("mqttDisconnect")}
          </Button>
        ) : (
          <Button type="submit" disabled={locked}>
            {t("mqttConnect")}
          </Button>
        )}
      </form>

      <details className="mt-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium">{t("mqttEsp32Instructions")}</summary>
        <RtcProtocol deviceId={deviceId} ownerId={ownerId} settings={settings} open={open} />
      </details>
    </details>
  );
}
