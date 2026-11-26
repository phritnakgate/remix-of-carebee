import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { ChevronLeft, ChevronRight, History as HistoryIcon } from "lucide-react";
import { useState } from "react";

import { DoseCard, EmptyState, PageHeader, StatusBadge, fmtTime, useDateFns, useLongDate } from "@/components/med-ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveBox } from "@/lib/active-box";
import { useI18n, type DictKey } from "@/lib/i18n";
import { lastNDates, scheduleSlotLabel, scheduledDate, summarize, toDateKey } from "@/lib/medication";
import { useDoses, useNow } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({
    meta: [
      { title: "History — Smart Medicine Reminder Box" },
      { name: "description", content: "Daily and weekly medication history with confirmation times." },
      { property: "og:title", content: "History — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Daily and weekly medication history with confirmation times." },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t("history")} />
      <Tabs defaultValue="daily">
        <TabsList className="mb-4 h-12 rounded-xl p-1">
          <TabsTrigger value="daily" className="h-11 rounded-lg px-4 text-base font-semibold">
            {t("daily")}
          </TabsTrigger>
          <TabsTrigger value="weekly" className="h-11 rounded-lg px-4 text-base font-semibold">
            {t("weekly")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <Daily />
        </TabsContent>
        <TabsContent value="weekly">
          <Weekly />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Daily() {
  const { t } = useI18n();
  const longDate = useLongDate();
  const { ownerId } = useActiveBox();
  const now = useNow();
  const [offset, setOffset] = useState(0);
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const key = toDateKey(day);
  const { doses, isLoading } = useDoses([ownerId], [key], now);
  const s = summarize(doses);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-3 shadow-soft">
        <Button variant="ghost" size="icon" onClick={() => setOffset(offset - 1)} aria-label={t("previous")}>
          <ChevronLeft className="!size-7" />
        </Button>
        <div className="text-center">
          <p className="text-xl font-bold">{longDate(day)}</p>
          {offset === 0 && <p className="text-sm font-semibold text-primary">{t("todayLabel")}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label={t("next")}>
          <ChevronRight className="!size-7" />
        </Button>
      </div>
      {s.total > 0 && (
        <div className="flex flex-wrap gap-2 text-base">
          <StatusBadge status="taken" /> <span className="mr-3 font-bold tabular-nums">{s.taken}</span>
          <StatusBadge status="pending" /> <span className="mr-3 font-bold tabular-nums">{s.pending}</span>
          {s.partial > 0 && <><StatusBadge status="partial" /> <span className="mr-3 font-bold tabular-nums">{s.partial}</span></>}
          <StatusBadge status="missed" /> <span className="font-bold tabular-nums">{s.missed}</span>
        </div>
      )}
      {isLoading ? (
        <p className="text-lg text-muted-foreground">{t("loading")}</p>
      ) : doses.length === 0 ? (
        <EmptyState icon={<HistoryIcon className="size-8" />} title={t("noRecords")} />
      ) : (
        <div className="space-y-3">
          {doses.map((d) => (
            <DoseCard key={d.key} dose={d} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function Weekly() {
  const { t } = useI18n();
  const locale = useDateFns();
  const { ownerId } = useActiveBox();
  const now = useNow();
  const dates = lastNDates(7, now);
  const { doses, isLoading } = useDoses([ownerId], dates, now);
  const total = summarize(doses);

  if (isLoading) return <p className="text-lg text-muted-foreground">{t("loading")}</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-card p-3.5 sm:p-4 shadow-soft">
        <h2 className="text-xl font-bold">{t("weekSummary")}</h2>
        <div className="mt-4 grid grid-cols-7 items-end gap-2 sm:gap-4" style={{ height: "14rem" }}>
          {dates.map((date) => {
            const s = summarize(doses.filter((d) => d.date === date));
            const max = Math.max(1, ...dates.map((x) => doses.filter((d) => d.date === x).length));
            const h = (n: number) => `${(n / max) * 100}%`;
            return (
              <div key={date} className="flex h-full flex-col items-center gap-2">
                <div className="flex w-full max-w-14 flex-1 flex-col-reverse overflow-hidden rounded-xl bg-muted">
                  <div className="bg-taken" style={{ height: h(s.taken) }} title={`${t("taken")} ${s.taken}`} />
                  <div className="bg-missed" style={{ height: h(s.missed) }} title={`${t("missed")} ${s.missed}`} />
                  <div className="bg-yellow-400" style={{ height: h(s.partial) }} title={`${t("partial")} ${s.partial}`} />
                  <div className="bg-pending" style={{ height: h(s.pending) }} title={`${t("pending")} ${s.pending}`} />
                </div>
                <span className="text-sm font-semibold">{format(scheduledDate(date, "00:00"), "EEE", { locale })}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-4 text-base font-semibold">
          <span>
            {t("taken")}: <span className="tabular-nums">{total.taken}</span>
          </span>
          <span>
            {t("missed")}: <span className="tabular-nums">{total.missed}</span>
          </span>
          {total.partial > 0 && <span>{t("partial")}: <span className="tabular-nums">{total.partial}</span></span>}
          <span>
            {t("adherence")}: <span className="tabular-nums">{total.adherence === null ? "—" : `${total.adherence}%`}</span>
          </span>
        </div>
      </section>

      <section className="overflow-x-auto rounded-3xl border bg-card shadow-soft">
        <table className="w-full min-w-[36rem] text-base">
          <thead>
            <tr className="text-left">
              <th className="p-4">{t("days")}</th>
              <th className="p-4">{t("medicines")}</th>
              <th className="p-4">{t("time")}</th>
              <th className="p-4">{t("takenAt")}</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {[...doses].reverse().map((d) => (
              <tr key={d.key} className="border-t">
                <td className="p-4 whitespace-nowrap">{format(d.scheduledAt, "EEE d MMM", { locale })}</td>
                <td className="p-4 font-semibold">{d.medicine.name}</td>
                <td className="p-4 tabular-nums">
                  {fmtTime(d.schedule.dose_time)} <span className="text-muted-foreground">· {t(scheduleSlotLabel(d.schedule))}</span>
                </td>
                <td className="p-4 tabular-nums">{d.log ? format(new Date(d.log.confirmed_at), "HH:mm") : "—"}</td>
                <td className="p-4">
                  <StatusBadge status={d.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
