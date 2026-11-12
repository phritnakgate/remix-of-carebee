import { format } from "date-fns";
import { th as thLocale, enGB } from "date-fns/locale";
import { AlertCircle, Check, CheckCircle2, Clock, FlaskConical, Pill, Undo2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useI18n, type DictKey } from "@/lib/i18n";
import type { Dose, DoseStatus } from "@/lib/medication";
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
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {body && <p className="mt-2 text-lg text-muted-foreground">{body}</p>}
      </div>
      {action}
    </div>
  );
}

const statusStyles: Record<DoseStatus, string> = {
  taken: "bg-taken-soft text-taken-foreground",
  pending: "bg-pending-soft text-pending-foreground",
  missed: "bg-missed-soft text-missed-foreground",
};
const statusIcon: Record<DoseStatus, typeof Check> = { taken: CheckCircle2, pending: Clock, missed: AlertCircle };

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
}: {
  dose: Dose;
  onTake?: () => void;
  onUndo?: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const m = dose.medicine;
  const confirmed = dose.log ? format(new Date(dose.log.confirmed_at), "HH:mm") : null;
  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-soft sm:flex-row sm:items-center",
        dose.dueNow && "border-pending ring-2 ring-pending/30",
        dose.status === "missed" && "border-missed/40",
      )}
    >
      <div className="flex flex-1 items-start gap-4">
        <div className="flex flex-col items-center">
          <span className="text-2xl font-bold tabular-nums">{fmtTime(dose.schedule.dose_time)}</span>
          <span className="text-sm text-muted-foreground">{t(`slot_${dose.schedule.slot}` as DictKey)}</span>
        </div>
        <span className={cn("mt-1 grid size-12 shrink-0 place-items-center rounded-2xl text-primary-foreground", medColorClass[m.color] ?? "bg-primary")}>
          <Pill className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-xl font-bold">
            {m.name} {m.dosage && <span className="font-medium text-muted-foreground">· {m.dosage}</span>}
          </h3>
          <p className="text-base text-muted-foreground">
            {m.pills_per_dose} {t("pills")} · {t(`food_${m.food_instruction}` as DictKey)}
            {m.compartment ? ` · #${m.compartment}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
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
        <div className="flex gap-2 sm:flex-col sm:items-end">
          {dose.status !== "taken" && onTake && (
            <Button size="lg" variant="success" onClick={onTake} disabled={busy} className="flex-1 sm:flex-none">
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
    <div className={cn("rounded-2xl p-5", tones[tone])}>
      <div className="text-4xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-base font-semibold">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed bg-card/60 px-6 py-12 text-center">
      <div className="grid size-16 place-items-center rounded-3xl bg-primary-soft text-primary">{icon}</div>
      <p className="text-lg text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}

export function useLongDate() {
  const locale = useDateFns();
  return (d: Date) => format(d, "EEEE d MMMM", { locale });
}
