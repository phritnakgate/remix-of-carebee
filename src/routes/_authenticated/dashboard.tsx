import { createFileRoute, Link } from "@tanstack/react-router";
import { PartyPopper, Pill, Plus } from "lucide-react";
import { toast } from "sonner";

import { HardwareSummary } from "@/components/hardware-status";
import { DoseCard, EmptyState, StatTile, fmtTime, useLongDate } from "@/components/med-ui";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useActiveBox } from "@/lib/active-box";
import { useI18n } from "@/lib/i18n";
import { scheduleFood, scheduleSlotLabel, summarize, toDateKey } from "@/lib/medication";
import { useConfirmDose, useDevices, useDoses, useNow, useUndoDose } from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Today — Smart Medicine Reminder Box" },
      { name: "description", content: "Today's medicines, taken and missed doses, and reminder box status." },
      { property: "og:title", content: "Today — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Today's medicines, taken and missed doses, and reminder box status." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { t } = useI18n();
  const longDate = useLongDate();
  const { ownerId, userId, isOwn, ownerProfile, me } = useActiveBox();
  const now = useNow();
  const today = toDateKey(now);
  const { doses, isLoading } = useDoses([ownerId], [today], now);
  const devices = useDevices(ownerId);
  const boxNames = new Map((devices.data ?? []).filter((d) => d.mode === "real").map((d) => [d.id, d.name]));
  const confirm = useConfirmDose();
  const undo = useUndoDose();
  const s = summarize(doses);
  const next = doses.find((d) => d.status === "pending");

  const hour = now.getHours();
  const greeting = hour < 12 ? t("goodMorning") : hour < 17 ? t("goodAfternoon") : t("goodEvening");
  const name = isOwn ? me?.display_name : ownerProfile?.display_name;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-hero p-4 shadow-soft sm:p-6">
        <p className="text-lg font-semibold text-muted-foreground">{longDate(now)}</p>
        <h1 className="mt-1 text-3xl font-bold sm:text-4xl">
          {greeting}
          {name ? `, ${name}` : ""}
        </h1>
        {next ? (
          <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl bg-card/80 p-5">
            <div className="text-3xl font-bold tabular-nums text-primary sm:text-4xl">{fmtTime(next.schedule.dose_time)}</div>
            <div>
              <p className="text-base font-semibold text-muted-foreground">{t("nextDose")}</p>
              <p className="text-2xl font-bold">
                {next.medicine.name}{" "}
                <span className="text-lg font-medium text-muted-foreground">
                  · {t(next.schedule.box_slot ? scheduleSlotLabel(next.schedule) : `food_${scheduleFood(next.schedule, next.medicine)}`)}
                  {next.medicine.device_id && boxNames.has(next.medicine.device_id) ? ` · ${boxNames.get(next.medicine.device_id)}` : ""}
                </span>
              </p>
            </div>
          </div>
        ) : s.total > 0 ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-taken-soft p-5 text-xl font-bold text-taken-foreground">
            <PartyPopper className="size-7" aria-hidden /> {t("allDone")}
          </div>
        ) : null}
        {s.total > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-base font-semibold">
              <span>{t("todayProgress")}</span>
              <span className="tabular-nums">
                {s.taken}/{s.total}
              </span>
            </div>
            <Progress value={(s.taken / s.total) * 100} className="h-4 bg-card" />
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("taken")} value={s.taken} tone="taken" />
        <StatTile label={t("pending")} value={s.pending} tone="pending" />
        <StatTile label={t("missed")} value={s.missed} tone="missed" />
        <StatTile label={t("adherence")} value={s.adherence === null ? "—" : `${s.adherence}%`} tone="primary" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section>
          <h2 className="mb-4 text-2xl font-bold">{t("todaySchedule")}</h2>
          {isLoading ? (
            <p className="text-lg text-muted-foreground">{t("loading")}</p>
          ) : doses.length === 0 ? (
            <EmptyState
              icon={<Pill className="size-8" />}
              title={t("noDosesToday")}
              action={
                <Button asChild size="lg">
                  <Link to="/medicines">
                    <Plus aria-hidden /> {t("addFirstMedicine")}
                  </Link>
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {doses.map((d) => (
                <DoseCard
                  key={d.key}
                  dose={d}
                  boxName={d.medicine.device_id ? boxNames.get(d.medicine.device_id) : undefined}
                  busy={confirm.isPending || undo.isPending}
                  onTake={() =>
                    confirm.mutate(
                      { dose: d, userId },
                      { onSuccess: () => toast.success(`${d.medicine.name} — ${t("taken")}`), onError: (e) => toast.error(e.message) },
                    )
                  }
                  onUndo={() => undo.mutate(d, { onError: (e) => toast.error(e.message) })}
                />
              ))}
            </div>
          )}
        </section>
        <aside>
          <HardwareSummary devices={devices.data ?? []} now={now} />
        </aside>
      </div>
    </div>
  );
}
