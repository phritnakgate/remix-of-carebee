import { useState } from "react";
import { toast } from "sonner";

import { MqttTrafficPanel } from "@/components/mqtt-traffic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { boxTopic, mqttDefaults, mqttSettingsSchema, type MqttSettings } from "@/lib/mqtt";
import { readMqttSettings, useMqttSession } from "@/lib/mqtt-session";
import { useMedicines } from "@/lib/queries";
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
  const [draft, setDraft] = useState(() => readMqttSettings(deviceId) ?? mqttDefaults);
  const { connections, traffic, clearTraffic, publishTest, connect, disconnect } = useMqttSession();
  const medicines = useMedicines(open ? [ownerId] : []);
  const connection = connections[deviceId];
  const settings = connection?.settings ?? draft;
  const indicator = states[connection?.state ?? "disconnected"];
  const locked = !!connection;
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
          <span className="text-sm text-muted-foreground">{t("mqttRetrying")}</span>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{t("mqttKeepTabOpen")}</p>
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
          const parsed = mqttSettingsSchema.safeParse(settings);
          if (!parsed.success) {
            toast.error(t("mqttInvalidSettings"));
            return;
          }
          setDraft(parsed.data);
          connect(deviceId, parsed.data);
        }}
      >
        <fieldset disabled={locked} className="space-y-5 disabled:opacity-70">
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("mqttMedicines")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.medicineIds === null}
                onChange={(event) => patch({ medicineIds: event.target.checked ? null : [] })}
              />
              {t("mqttAllMedicines")}
            </label>
            {settings.medicineIds !== null && (
              <div className="grid gap-2 pl-5 sm:grid-cols-2">
                {medicines.isPending && (
                  <p className="text-sm text-muted-foreground">{t("loading")}</p>
                )}
                {(medicines.data ?? []).map((medicine) => (
                  <label key={medicine.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={settings.medicineIds?.includes(medicine.id) ?? false}
                      onChange={(event) => {
                        const selected = settings.medicineIds ?? [];
                        patch({
                          medicineIds: event.target.checked
                            ? [...selected, medicine.id]
                            : selected.filter((id) => id !== medicine.id),
                        });
                      }}
                    />
                    {medicine.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={field("payload")}>{t("mqttPayload")}</Label>
            <Textarea
              id={field("payload")}
              value={settings.payload}
              onChange={(event) => patch({ payload: event.target.value })}
              maxLength={4096}
              className="font-mono"
              placeholder={'{"command":"remind"}'}
            />
            <p className="text-sm text-muted-foreground">{t("mqttPayloadHint")}</p>
          </div>
        </fieldset>

        {connection ? (
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
        <p className="mt-2">{t("mqttSensorHint")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3">
          {
            '{"device_key":"smrb_…","status":{"led":"on","compartments":[{"number":1,"open":false}]}}'
          }
        </pre>
        <p className="mt-2">{t("mqttConfirmHint")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3">
          {'{"device_key":"smrb_…","schedule_id":"…","scheduled_date":"YYYY-MM-DD"}'}
        </pre>
      </details>
    </details>
  );
}
