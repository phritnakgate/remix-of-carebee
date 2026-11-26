import { format } from "date-fns";
import { th as thLocale, enGB } from "date-fns/locale";
import { AlertCircle, Check, CheckCircle2, Clock, FlaskConical, Pill, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useI18n, type DictKey } from "@/lib/i18n";
import { scheduleCompartment, scheduleFood, scheduleSlotLabel, type Dose, type DoseStatus } from "@/lib/medication";
import { cn } from "@/lib/utils";

export const MED_COLORS = ["blue", "green", "amber", "rose", "teal", "slate"] as const;
export const medColorClass: Record<string, string> = {
  blue: "bg-primary",
  green: "bg-taken",
  amber: "bg-pending",
  rose: "bg-missed",
  teal: "bg-chart-5",
  slate: "bg-sim",
};

export function useDateFns() {
  const { lang } = useI18n();
  return lang === "th" ? thLocale : enGB;
}

export function fmtTime(time: string) {
  return time.slice(0, 5);
}

export function PageHeader({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-5">
      <div className="min-w-0 flex-1 basis-44">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {body && <p className="mt-1 text-sm text-muted-foreground sm:text-base">{body}</p>}
      </div>
      {action}
    </div>
  );
}

const statusStyles: Record<DoseStatus, string> = {
  taken: "bg-taken-soft text-taken-foreground",
  pending: "bg-pending-soft text-pending-foreground",
  missed: "bg-missed-soft text-missed-foreground",
  partial: "bg-yellow-100 text-yellow-900",
};
const statusIcon: Record<DoseStatus, typeof Check> = { taken: CheckCircle2, pending: Clock, missed: AlertCircle, partial: AlertCircle };

export function StatusBadge({ status, className }: { status: DoseStatus; className?: string }) {
  const { t } = useI18n();
  const Icon = statusIcon[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", statusStyles[status], className)}>
      <Icon className="size-4" aria-hidden />
      {t(status)}
    </span>
  );
}

export function SimBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-dashed border-sim bg-sim-soft px-3 py-1 text-sm font-semibold text-sim-foreground", className)}>
      <FlaskConical className="size-4" aria-hidden />
      {t("simulated")}
    </span>
  );
}

export function SourceLabel({ source }: { source: string }) {
  const { t } = useI18n();
  if (source === "simulated") return <SimBadge className="py-0.5 text-xs" />;
  return <span>{t(`source_${source}` as DictKey)}</span>;
}

export function DoseCard({
  dose,
  onTake,
  onUndo,
  busy,
  compact,
  boxName,
}: {
  dose: Dose;
  onTake?: () => void;
  onUndo?: () => void;
  busy?: boolean;
  compact?: boolean;
  boxName?: string | undefined;
}) {
  const { t } = useI18n();
  const m = dose.medicine;
  const compartment = scheduleCompartment(dose.schedule, m);
  const confirmed = dose.log ? format(new Date(dose.log.confirmed_at), "HH:mm") : null;
  return (
    <article
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-soft sm:p-4 md:flex-row md:items-center",
        dose.dueNow && "border-pending ring-2 ring-pending/30",
        dose.status === "missed" && "border-missed/40",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:gap-3">
        <div className="flex w-[4.25rem] shrink-0 flex-col items-center">
          <span className="text-xl font-bold tabular-nums">{fmtTime(dose.schedule.dose_time)}</span>
          <span className="text-center text-xs text-muted-foreground">{t(scheduleSlotLabel(dose.schedule))}</span>
        </div>
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-primary-foreground sm:size-9", medColorClass[m.color] ?? "bg-primary")}>
          <Pill className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-bold sm:text-lg">
            {m.name} {m.dosage && <span className="font-medium text-muted-foreground">· {m.dosage}</span>}
          </h3>
          <p className="break-words text-sm text-muted-foreground">
            {m.pills_per_dose} {t("pills")}
            {!dose.schedule.box_slot ? ` · ${t(`food_${scheduleFood(dose.schedule, m)}`)}` : ""}
            {boxName ? ` · ${boxName}` : ""}{compartment ? ` · #${compartment}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {dose.dueNow ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-pending px-3 py-1 font-semibold text-foreground">
                <Clock className="size-4" aria-hidden /> {t("dueNow")}
              </span>
            ) : (
              <StatusBadge status={dose.status} />
            )}
            {confirmed && dose.log && (
              <span className="inline-flex items-center gap-1.5">
                {t("takenAt")} {confirmed} · <SourceLabel source={dose.log.source} />
              </span>
            )}
          </div>
        </div>
      </div>
      {!compact && (
        <div className="flex gap-2 md:flex-col md:items-end">
          {dose.status !== "taken" && onTake && (
            <Button variant="success" onClick={onTake} disabled={busy} className="flex-1 md:flex-none">
              <Check aria-hidden /> {t("markTaken")}
            </Button>
          )}
          {dose.status === "taken" && onUndo && dose.log?.source !== "device" && (
            <Button variant="ghost" onClick={onUndo} disabled={busy}>
              <Undo2 aria-hidden /> {t("undo")}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: ReactNode; tone: "taken" | "pending" | "missed" | "primary" }) {
  const tones = {
    taken: "bg-taken-soft text-taken-foreground",
    pending: "bg-pending-soft text-pending-foreground",
    missed: "bg-missed-soft text-missed-foreground",
    primary: "bg-primary-soft text-accent-foreground",
  };
  return (
    <div className={cn("rounded-xl p-3 sm:p-4", tones[tone])}>
      <div className="text-2xl font-bold tabular-nums sm:text-3xl">{value}</div>
      <div className="mt-0.5 text-sm font-semibold">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-4 py-7 text-center sm:py-9">
      <div className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary [&>svg]:size-6">{icon}</div>
      <p className="text-base text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

export function useLongDate() {
  const locale = useDateFns();
  return (d: Date) => format(d, "EEEE d MMMM", { locale });
}
