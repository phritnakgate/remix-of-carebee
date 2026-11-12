import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BellRing, CheckCircle2, Clock, HeartHandshake, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { EmptyState, PageHeader, StatTile, fmtTime } from "@/components/med-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBox } from "@/lib/active-box";
import { useI18n } from "@/lib/i18n";
import { summarize, toDateKey } from "@/lib/medication";
import { useDoses, useLiveUpdates, useNow } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/caregiver")({
  head: () => ({
    meta: [
      { title: "Caregiver — Smart Medicine Reminder Box" },
      { name: "description", content: "Monitor family members' medication and get alerts for unconfirmed doses." },
      { property: "og:title", content: "Caregiver — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Monitor family members' medication and get alerts for unconfirmed doses." },
    ],
  }),
  component: CaregiverPage,
});

function CaregiverPage() {
  const { t } = useI18n();
  const { elders, setOwnerId, userId } = useActiveBox();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const ids = elders.map((e) => e.id);
  useLiveUpdates(ids);
  const { doses, isLoading } = useDoses(ids, [toDateKey(now)], now);
  const [code, setCode] = useState("");
  const [linking, setLinking] = useState(false);

  const alerts = doses.filter((d) => d.status === "missed" || d.dueNow);
  const nameOf = (id: string) => elders.find((e) => e.id === id)?.display_name ?? "—";

  // Pop a notification the first time a dose becomes missed while this page is open.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (isLoading) return;
    const missed = doses.filter((d) => d.status === "missed").map((d) => d.key);
    if (seen.current) {
      for (const k of missed) {
        if (!seen.current.has(k)) {
          const d = doses.find((x) => x.key === k)!;
          toast.error(`${t("missedAlert")}: ${nameOf(d.schedule.owner_id)} — ${d.medicine.name} ${fmtTime(d.schedule.dose_time)}`);
        }
      }
    }
    seen.current = new Set(missed);
  }, [doses, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function link(e: FormEvent) {
    e.preventDefault();
    setLinking(true);
    const { error } = await supabase.rpc("accept_caregiver_invite", { _code: code.trim().toUpperCase() });
    setLinking(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("linked"));
    setCode("");
    qc.invalidateQueries({ queryKey: ["links", userId] });
  }

  return (
    <div className="space-y-10">
      <PageHeader title={t("caregiver")} body={t("caregiverBody")} />

      <section className="rounded-3xl border bg-card p-6 shadow-soft">
        <h2 className="text-xl font-bold">{t("joinAsCaregiver")}</h2>
        <form onSubmit={link} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            aria-label={t("inviteCode")}
            placeholder={t("enterCode")}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={12}
            required
            className="h-14 font-mono text-xl uppercase tracking-widest"
          />
          <Button type="submit" size="lg" disabled={linking}>
            <HeartHandshake aria-hidden /> {t("link")}
          </Button>
        </form>
      </section>

      {elders.length === 0 ? (
        <EmptyState icon={<UserRound className="size-8" />} title={t("noElders")} />
      ) : (
        <>
          <section>
            <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
              <BellRing className="size-6 text-missed" aria-hidden /> {t("alerts")}
            </h2>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl bg-taken-soft p-5 text-lg font-semibold text-taken-foreground">
                <CheckCircle2 className="size-6" aria-hidden /> {t("noAlerts")}
              </div>
            ) : (
              <ul className="space-y-3">
                {alerts.map((d) => (
                  <li
                    key={d.key}
                    className={cn(
                      "flex flex-wrap items-center gap-4 rounded-2xl border-2 p-5",
                      d.status === "missed" ? "border-missed/40 bg-missed-soft" : "border-pending/50 bg-pending-soft",
                    )}
                  >
                    {d.status === "missed" ? (
                      <AlertCircle className="size-8 text-missed" aria-hidden />
                    ) : (
                      <Clock className="size-8 text-pending-foreground" aria-hidden />
                    )}
                    <div className="flex-1">
                      <p className="text-lg font-bold">
                        {d.status === "missed" ? t("missedAlert") : t("dueAlert")} · {nameOf(d.schedule.owner_id)}
                      </p>
                      <p className="text-base">
                        {d.medicine.name} · {fmtTime(d.schedule.dose_time)} — {t("notConfirmed")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOwnerId(d.schedule.owner_id);
                        navigate({ to: "/dashboard" });
                      }}
                    >
                      {t("viewDetails")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            {elders.map((e) => {
              const mine = doses.filter((d) => d.schedule.owner_id === e.id);
              const s = summarize(mine);
              return (
                <article key={e.id} className="rounded-3xl border bg-card p-6 shadow-soft">
                  <div className="flex items-center gap-4">
                    {e.avatar_url ? (
                      <img src={e.avatar_url} alt="" className="size-14 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="grid size-14 place-items-center rounded-full bg-secondary text-secondary-foreground">
                        <UserRound className="size-7" aria-hidden />
                      </span>
                    )}
                    <div className="flex-1">
                      <h3 className="text-2xl font-bold">{e.display_name ?? "—"}</h3>
                      {e.phone && <a href={`tel:${e.phone}`} className="text-base text-primary">{e.phone}</a>}
                    </div>
                  </div>
                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <StatTile label={t("taken")} value={s.taken} tone="taken" />
                    <StatTile label={t("pending")} value={s.pending} tone="pending" />
                    <StatTile label={t("missed")} value={s.missed} tone="missed" />
                  </div>
                  {s.total > 0 && <Progress value={(s.taken / s.total) * 100} className="mt-4 h-3" />}
                  <Button
                    className="mt-5 w-full"
                    size="lg"
                    variant="soft"
                    onClick={() => {
                      setOwnerId(e.id);
                      navigate({ to: "/dashboard" });
                    }}
                  >
                    {t("viewDetails")}
                  </Button>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
