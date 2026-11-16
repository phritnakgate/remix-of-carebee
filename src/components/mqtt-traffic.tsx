import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n, type DictKey } from "@/lib/i18n";
import type { MqttMessageState, MqttTraffic } from "@/lib/mqtt";
import { cn } from "@/lib/utils";

const messageStates = {
  received: { label: "mqttMessageReceived", tone: "bg-muted text-muted-foreground" },
  processed: { label: "mqttMessageProcessed", tone: "bg-taken-soft text-taken-foreground" },
  notProcessed: { label: "mqttMessageNotProcessed", tone: "bg-missed-soft text-missed-foreground" },
  retained: { label: "mqttMessageRetained", tone: "bg-muted text-muted-foreground" },
  oversize: { label: "mqttMessageOversize", tone: "bg-muted text-muted-foreground" },
  sending: { label: "mqttMessageSending", tone: "bg-pending-soft text-pending-foreground" },
  acknowledged: { label: "mqttMessageAcknowledged", tone: "bg-taken-soft text-taken-foreground" },
  sendFailed: { label: "mqttMessageSendFailed", tone: "bg-missed-soft text-missed-foreground" },
} satisfies Record<MqttMessageState, { label: DictKey; tone: string }>;

const columns = [
  {
    direction: "incoming",
    heading: "mqttIncoming",
    empty: "mqttIncomingEmpty",
    Icon: ArrowDownLeft,
  },
  {
    direction: "outgoing",
    heading: "mqttOutgoing",
    empty: "mqttOutgoingEmpty",
    Icon: ArrowUpRight,
  },
] as const;

export function MqttTrafficPanel({
  logs,
  onClear,
}: {
  logs: MqttTraffic | undefined;
  onClear: () => void;
}) {
  const { t, lang } = useI18n();
  const time = new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <section aria-label={t("mqttTraffic")} className="mt-5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold">{t("mqttTraffic")}</h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          disabled={!logs?.incoming.length && !logs?.outgoing.length}
        >
          {t("mqttClearTraffic")}
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {columns.map(({ direction, heading, empty, Icon }) => {
          const entries = logs?.[direction] ?? [];
          return (
            <div
              key={direction}
              className="min-w-0 overflow-hidden rounded-xl border bg-background"
            >
              <h5 className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-sm font-semibold">
                <Icon className="size-4 text-primary" aria-hidden /> {t(heading)}
              </h5>
              {entries.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">{t(empty)}</p>
              ) : (
                <ol
                  aria-label={t(heading)}
                  tabIndex={0}
                  className="max-h-80 space-y-2 overflow-y-auto px-3 py-2"
                >
                  {entries.map((entry) => {
                    const state = messageStates[entry.state];
                    return (
                      <li key={entry.id} className="space-y-2 rounded-lg border p-2">
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <time
                            className="text-xs tabular-nums text-muted-foreground"
                            dateTime={new Date(entry.at).toISOString()}
                          >
                            {time.format(entry.at)}
                          </time>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              state.tone,
                            )}
                          >
                            {t(state.label)}
                          </span>
                        </div>
                        <code className="block break-all text-xs font-medium">{entry.topic}</code>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">
                          {entry.payload || t("mqttEmptyPayload")}
                        </pre>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
