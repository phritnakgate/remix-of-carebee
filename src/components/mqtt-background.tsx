import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { getMqttBackground, saveMqttBackground } from "@/lib/mqtt-background.functions";
import { boxTopic, mqttBrokerUrl, type MqttSettings } from "@/lib/mqtt";

export function MqttBackground({
  deviceId,
  settings,
  open,
}: {
  deviceId: string;
  settings: MqttSettings;
  open: boolean;
}) {
  const { t, locale } = useI18n();
  const [saving, setSaving] = useState(false);
  const status = useQuery({
    queryKey: ["mqtt-background", deviceId],
    enabled: open,
    queryFn: () => getMqttBackground({ data: { deviceId } }),
    refetchInterval: open ? 30000 : false,
    retry: false,
  });
  const data = status.data;
  const active = data?.config?.enabled === true;
  const live = !!data?.lastTick && Date.now() - new Date(data.lastTick).getTime() < 180000;
  const format = (value: string) => new Date(value).toLocaleString(locale);

  async function save(enabled: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      const data = enabled
        ? { deviceId, enabled: true as const, settings }
        : { deviceId, enabled: false as const };
      await saveMqttBackground({ data });
      await status.refetch();
      toast.success(t("saved"));
    } catch {
      toast.error(t("mqttBackgroundSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 space-y-2 rounded-xl border p-3">
      <h4 className="text-sm font-bold">{t("mqttBackgroundTitle")}</h4>
      <p className="text-sm text-muted-foreground">{t("mqttBackgroundHint")}</p>
      {status.isPending && (
        <p role="status" className="text-sm">
          {t("loading")}
        </p>
      )}
      {status.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("mqttBackgroundLoadFailed")}
        </p>
      )}
      {data && (
        <>
          {!data.available ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("mqttBackgroundNotSetup")}
            </p>
          ) : (
            <>
              <p
                role="status"
                className={live ? "text-sm text-green-700" : "text-sm text-destructive"}
              >
                {t(live ? "mqttBackgroundTimerReady" : "mqttBackgroundTimerMissing")}
              </p>
              <p className="text-sm font-medium">
                {t(active ? "mqttBackgroundEnabled" : "mqttBackgroundDisabled")}
              </p>
              {active && data.config && (
                <div className="space-y-1 break-all text-xs text-muted-foreground">
                  <p>{mqttBrokerUrl(data.config.settings as MqttSettings)}</p>
                  <p>{boxTopic((data.config.settings as MqttSettings).scheduleTopic, deviceId)}</p>
                </div>
              )}
              {data.config?.last_published_at && (
                <p className="text-xs">
                  {t("mqttBackgroundLastSent")} {format(data.config.last_published_at)}
                </p>
              )}
              {data.config?.last_error && (
                <p role="alert" className="text-sm text-destructive">
                  {t("mqttBackgroundDeliveryFailed")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || !live}
                  onClick={() => void save(true)}
                >
                  {t(saving ? "loading" : active ? "mqttBackgroundUpdate" : "mqttBackgroundEnable")}
                </Button>
                {active && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void save(false)}
                  >
                    {t("mqttBackgroundDisable")}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
