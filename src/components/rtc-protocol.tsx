import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { BOX_SLOTS } from "@/lib/medication";
import { boxTopic, type MqttSettings } from "@/lib/mqtt";
import { rtcMqttPayload } from "@/lib/rtc";
import { getRtcSchedule } from "@/lib/rtc.functions";
import { useDevices } from "@/lib/queries";
import { useDeviceKey } from "@/lib/device-key-session";

export function RtcProtocol({
  deviceId,
  ownerId,
  settings,
  open,
}: {
  deviceId: string;
  ownerId: string;
  settings: MqttSettings;
  open: boolean;
}) {
  const { t } = useI18n();
  const [compartment, setCompartment] = useState(1);
  const config = useQuery({
    queryKey: ["rtc-config", deviceId],
    queryFn: () => getRtcSchedule({ data: { deviceId } }),
    enabled: open,
    staleTime: 5_000,
    retry: false,
  });
  const device = useDevices(ownerId).data?.find((item) => item.id === deviceId);
  const deviceKey = useDeviceKey(ownerId, deviceId, device?.key_prefix);
  const status = device?.last_status as { rtc_revision?: string } | undefined;
  const synced = !!config.data && status?.rtc_revision === config.data.revision;
  const inputTopic = boxTopic(settings.sensorTopic, deviceId);
  const outputTopic = boxTopic(settings.scheduleTopic, deviceId);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("rtcCopyFailed"));
    }
  }
  const incoming = JSON.stringify(
    {
      deviceId,
      compartment,
      weight: null,
      isTake: true,
      device_key: deviceKey ?? "<DEVICE_KEY>",
    },
    null,
    2,
  );
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p>{t("rtcOutgoingHint")}</p>
      <p role="status" className={synced ? "font-medium text-green-700" : "text-muted-foreground"}>
        {t(synced ? "rtcSynced" : "rtcWaiting")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t("rtcOutgoing")}</strong>
        <code className="break-all">{outputTopic}</code>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy(outputTopic)}>
          {t("copy")}
        </Button>
      </div>
      {config.isPending && <p>{t("loading")}</p>}
      {config.isError && (
        <p role="alert" className="text-destructive">
          {t("rtcConfigFailed")}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        {config.data?.channels.map((channel) => {
          const slot = BOX_SLOTS.filter((item) => item !== "bedtime")[channel.compartment - 1]!;
          const payload = JSON.stringify(rtcMqttPayload(channel, settings.compartmentWeightsG?.[channel.compartment - 1]), null, 2);
          return (
            <div key={channel.compartment} className="min-w-0 rounded-lg border p-2">
              <div className="flex items-center justify-between gap-2">
                <span>
                  #{channel.compartment} · {t(`round_${slot}`)}
                </span>
                <Button type="button" size="sm" variant="ghost" onClick={() => void copy(payload)}>
                  {t("copy")}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{payload}</pre>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <strong>{t("rtcIncoming")}</strong>
        <code className="break-all">{inputTopic}</code>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy(inputTopic)}>
          {t("copy")}
        </Button>
      </div>
      <p>{t("rtcIncomingHint")}</p>
      <label className="flex items-center gap-2">
        {t("compartment")}
        <select
          className="rounded border bg-background p-1"
          value={compartment}
          onChange={(event) => setCompartment(Number(event.target.value))}
        >
          {[1, 2, 3, 4, 5, 6].map((number) => (
            <option key={number} value={number}>
              #{number}
            </option>
          ))}
        </select>
      </label>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{incoming}</pre>
      <Button type="button" size="sm" variant="outline" onClick={() => void copy(incoming)}>
        {t("copy")}
      </Button>
      <p>{t("rtcKeyHint")}</p>
    </div>
  );
}
