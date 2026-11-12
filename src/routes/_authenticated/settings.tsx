import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Copy, KeyRound, UserRound, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { LangSwitch } from "@/components/lang-switch";
import { PageHeader } from "@/components/med-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBox, useLinks, type Profile } from "@/lib/active-box";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Smart Medicine Reminder Box" },
      { name: "description", content: "Profile, language and caregiver invitations." },
      { property: "og:title", content: "Settings — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Profile, language and caregiver invitations." },
    ],
  }),
  component: SettingsPage,
});

const TIMEZONES = ["Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "America/New_York", "Australia/Sydney"];

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function SettingsPage() {
  const { t } = useI18n();
  const { userId, me } = useActiveBox();
  const qc = useQueryClient();
  const links = useLinks(userId);
  const [profile, setProfile] = useState<Pick<Profile, "display_name" | "phone" | "timezone">>({ display_name: "", phone: "", timezone: "Asia/Bangkok" });
  useEffect(() => {
    if (me) setProfile({ display_name: me.display_name ?? "", phone: me.phone ?? "", timezone: me.timezone });
  }, [me]);

  const invites = useQuery({
    queryKey: ["invites", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("caregiver_invites")
        .select("*")
        .is("used_by", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: profile.display_name?.trim() || null, phone: profile.phone?.trim() || null, timezone: profile.timezone })
      .eq("id", userId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("saved"));
    qc.invalidateQueries({ queryKey: ["links", userId] });
  }

  async function createInvite() {
    const { error } = await supabase.from("caregiver_invites").insert({ code: makeCode(), elder_id: userId });
    if (error) {
      toast.error(error.message);
      return;
    }
    invites.refetch();
  }

  async function unlink(otherId: string, asElder: boolean) {
    const q = supabase.from("caregiver_links").delete();
    const { error } = asElder ? await q.eq("elder_id", userId).eq("caregiver_id", otherId) : await q.eq("caregiver_id", userId).eq("elder_id", otherId);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["links", userId] });
  }

  return (
    <div className="space-y-8">
      <PageHeader title={t("settings")} />

      <section className="rounded-3xl border bg-card p-6 shadow-soft">
        <h2 className="text-xl font-bold">{t("profile")}</h2>
        <form onSubmit={saveProfile} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dn" className="text-base font-semibold">{t("displayName")}</Label>
            <Input id="dn" maxLength={60} value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} className="h-12 text-lg" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ph" className="text-base font-semibold">{t("phone")}</Label>
            <Input id="ph" type="tel" maxLength={20} value={profile.phone ?? ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className="h-12 text-lg" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tz" className="text-base font-semibold">{t("timezone")}</Label>
            <Select value={profile.timezone} onValueChange={(v) => setProfile({ ...profile, timezone: v })}>
              <SelectTrigger id="tz" className="h-12 text-lg"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <span className="block text-base font-semibold">{t("language")}</span>
            <LangSwitch />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="lg">{t("save")}</Button>
          </div>
        </form>
      </section>

      <section className="rounded-3xl border bg-card p-6 shadow-soft">
        <h2 className="text-xl font-bold">{t("inviteCaregiver")}</h2>
        <p className="mt-1 text-base text-muted-foreground">{t("inviteCaregiverBody")}</p>
        <Button className="mt-4" size="lg" variant="soft" onClick={createInvite}>
          <KeyRound aria-hidden /> {t("createCode")}
        </Button>
        <ul className="mt-4 space-y-2">
          {(invites.data ?? []).map((inv) => (
            <li key={inv.code} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-muted p-4">
              <span className="font-mono text-3xl font-bold tracking-[0.25em]">{inv.code}</span>
              <span className="text-sm text-muted-foreground">{t("expires")}: {format(new Date(inv.expires_at), "d MMM yyyy")}</span>
              <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(inv.code); toast.success(t("copied")); }}>
                <Copy aria-hidden /> {t("copy")}
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <PeopleList title={t("myCaregivers")} people={links.data?.caregivers ?? []} onRemove={(id) => unlink(id, true)} />
        <PeopleList title={t("peopleICareFor")} people={links.data?.elders ?? []} onRemove={(id) => unlink(id, false)} />
      </div>
    </div>
  );
}

function PeopleList({ title, people, onRemove }: { title: string; people: Profile[]; onRemove: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="rounded-3xl border bg-card p-6 shadow-soft">
      <h2 className="text-xl font-bold">{title}</h2>
      {people.length === 0 ? (
        <p className="mt-3 text-base text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-muted p-3">
              <UserRound className="size-6 text-muted-foreground" aria-hidden />
              <span className="flex-1 text-lg font-semibold">{p.display_name ?? "—"}</span>
              <Button variant="ghost" size="sm" onClick={() => onRemove(p.id)}>
                <X aria-hidden /> {t("remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
