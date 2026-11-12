import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, CalendarDays } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader, fmtTime, medColorClass } from "@/components/med-ui";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBox } from "@/lib/active-box";
import { useI18n, type DictKey } from "@/lib/i18n";
import { TIME_SLOTS, type Schedule } from "@/lib/medication";
import { useMedicines, useNow, useSchedules } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/schedule")({
  head: () => ({
    meta: [
      { title: "Weekly schedule — Smart Medicine Reminder Box" },
      { name: "description", content: "Weekly medication times, days and reminder settings." },
      { property: "og:title", content: "Weekly schedule — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Weekly medication times, days and reminder settings." },
    ],
  }),
  component: SchedulePage,
});

const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday first

function SchedulePage() {
  const { t } = useI18n();
  const { ownerId } = useActiveBox();
  const qc = useQueryClient();
  const meds = useMedicines([ownerId]);
  const scheds = useSchedules([ownerId]);
  const now = useNow();
  const today = now.getDay();
  const medById = new Map((meds.data ?? []).map((m) => [m.id, m]));
  const list = (scheds.data ?? []).filter((s) => medById.get(s.medicine_id)?.active);

  async function update(s: Schedule, patch: Partial<Pick<Schedule, "dose_time" | "days_of_week" | "notify">>) {
    // optimistic
    qc.setQueryData<Schedule[]>(["schedules", [ownerId]], (old) => old?.map((x) => (x.id === s.id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("medication_schedules").update(patch).eq("id", s.id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["schedules"] });
  }

  return (
    <div className="space-y-10">
      <PageHeader title={t("schedule")} body={t("scheduleBody")} />

      {list.length === 0 ? (
        <EmptyState icon={<CalendarDays className="size-8" />} title={t("noMedicines")} />
      ) : (
        <>
          {/* Weekly overview */}
          <section className="overflow-x-auto rounded-3xl border bg-card shadow-soft">
            <table className="w-full min-w-[44rem] border-collapse text-base">
              <thead>
                <tr>
                  <th className="w-32 p-3" />
                  {DAYS.map((d) => (
                    <th key={d} className={cn("p-3 text-center font-bold", d === today && "text-primary")}>
                      <span className={cn("inline-block rounded-full px-3 py-1", d === today && "bg-primary-soft")}>{t(`day${d}` as DictKey)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TIME_SLOTS.map((slot) => (
                  <tr key={slot} className="border-t">
                    <th className="p-3 text-left font-semibold">{t(`slot_${slot}` as DictKey)}</th>
                    {DAYS.map((d) => {
                      const items = list.filter((s) => s.slot === slot && s.days_of_week.includes(d));
                      return (
                        <td key={d} className={cn("p-2 align-top", d === today && "bg-accent/50")}>
                          <div className="flex flex-col gap-1">
                            {items.map((s) => {
                              const m = medById.get(s.medicine_id)!;
                              return (
                                <span key={s.id} className="flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-sm font-semibold">
                                  <span className={cn("size-2.5 shrink-0 rounded-full", medColorClass[m.color])} />
                                  <span className="truncate">{m.name}</span>
                                  {!s.notify && <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label={t("reminderOff")} />}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Editable list */}
          <section className="space-y-3">
            {list.map((s) => {
              const m = medById.get(s.medicine_id)!;
              return (
                <article key={s.id} className="flex flex-col gap-4 rounded-3xl border bg-card p-5 shadow-soft lg:flex-row lg:items-center">
                  <div className="flex flex-1 items-center gap-3">
                    <span className={cn("size-4 shrink-0 rounded-full", medColorClass[m.color])} />
                    <div>
                      <h3 className="text-xl font-bold">{m.name}</h3>
                      <p className="text-base text-muted-foreground">{t(`slot_${s.slot}` as DictKey)} · {t(`food_${m.food_instruction}` as DictKey)}</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-base font-semibold">
                    {t("time")}
                    <Input
                      type="time"
                      defaultValue={fmtTime(s.dose_time)}
                      onBlur={(e) => e.target.value && e.target.value !== fmtTime(s.dose_time) && update(s, { dose_time: e.target.value })}
                      className="h-12 w-32 text-lg tabular-nums"
                    />
                  </label>
                  <div role="group" aria-label={t("days")} className="flex gap-1">
                    {DAYS.map((d) => {
                      const on = s.days_of_week.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            const next = on ? s.days_of_week.filter((x) => x !== d) : [...s.days_of_week, d].sort();
                            if (next.length) update(s, { days_of_week: next });
                          }}
                          className={cn(
                            "size-11 rounded-xl text-sm font-bold transition-colors",
                            on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                          )}
                        >
                          {t(`day${d}` as DictKey)}
                        </button>
                      );
                    })}
                  </div>
                  <label className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-2 text-base font-semibold">
                    {s.notify ? <Bell className="size-5 text-primary" aria-hidden /> : <BellOff className="size-5 text-muted-foreground" aria-hidden />}
                    <span className="w-28">{s.notify ? t("reminderOn") : t("reminderOff")}</span>
                    <Switch checked={s.notify} onCheckedChange={(v) => update(s, { notify: v })} aria-label={t("reminder")} />
                  </label>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
