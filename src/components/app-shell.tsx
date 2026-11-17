import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Cpu,
  HeartHandshake,
  History,
  Home,
  LogOut,
  Menu,
  Pill,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { LangSwitch } from "@/components/lang-switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBox } from "@/lib/active-box";
import { useI18n, type DictKey } from "@/lib/i18n";
import { useLiveUpdates } from "@/lib/queries";
import { cn } from "@/lib/utils";

type NavTo = "/dashboard" | "/medicines" | "/schedule" | "/history" | "/devices" | "/caregiver" | "/settings";
const NAV: { to: NavTo; label: DictKey; icon: LucideIcon; mobile: boolean }[] = [
  { to: "/dashboard", label: "navDashboard", icon: Home, mobile: true },
  { to: "/medicines", label: "navMedicines", icon: Pill, mobile: true },
  { to: "/schedule", label: "navSchedule", icon: CalendarDays, mobile: true },
  { to: "/history", label: "navHistory", icon: History, mobile: true },
  { to: "/devices", label: "navDevices", icon: Cpu, mobile: false },
  { to: "/caregiver", label: "navCaregiver", icon: HeartHandshake, mobile: false },
  { to: "/settings", label: "navSettings", icon: Settings, mobile: false },
];

function BoxSwitcher({ className }: { className?: string }) {
  const { t } = useI18n();
  const { ownerId, setOwnerId, elders, userId } = useActiveBox();
  if (elders.length === 0) return null;
  return (
    <div className={className}>
      <span className="mb-1 block text-sm font-semibold text-muted-foreground">{t("viewing")}</span>
      <Select value={ownerId} onValueChange={setOwnerId}>
        <SelectTrigger className="h-12 rounded-xl text-base">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={userId} className="text-base">
            {t("myBox")}
          </SelectItem>
          {elders.map((e) => (
            <SelectItem key={e.id} value={e.id} className="text-base">
              {e.display_name ?? "—"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useI18n();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => (
        <Link
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          className="flex h-14 items-center gap-4 rounded-2xl px-4 text-lg font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          activeProps={{ className: "bg-primary-soft !text-accent-foreground" }}
        >
          <n.icon className="size-6" aria-hidden />
          {t(n.label)}
        </Link>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { ownerId, isOwn, ownerProfile } = useActiveBox();
  const signOut = useSignOut();
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useLiveUpdates([ownerId]);

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col gap-4 border-r bg-sidebar p-4 lg:flex">
        <Link to="/dashboard" className="flex items-center gap-3 px-2">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand text-primary-foreground">
            <Pill className="size-6" aria-hidden />
          </span>
          <span className="text-lg font-bold leading-tight">{t("appName")}</span>
        </Link>
        <BoxSwitcher />
        <NavLinks />
        <div className="mt-auto flex flex-col gap-3">
          <LangSwitch />
          <button
            type="button"
            onClick={signOut}
            className="flex h-12 items-center gap-3 rounded-2xl px-4 text-base font-semibold text-muted-foreground hover:bg-accent"
          >
            <LogOut className="size-5" aria-hidden /> {t("signOut")}
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-card/90 px-4 py-2 backdrop-blur lg:hidden">
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-xl bg-brand text-primary-foreground">
              <Pill className="size-5" aria-hidden />
            </span>
            <span className="text-base font-bold">{t("appShort")}</span>
          </Link>
          <LangSwitch />
        </header>

        {!isOwn && (
          <div className="border-b bg-secondary px-4 py-3 text-center text-base font-semibold text-secondary-foreground sm:px-8">
            <HeartHandshake className="mr-2 inline size-5" aria-hidden />
            {t("viewing")}: {ownerProfile?.display_name ?? "—"}
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl flex-1 px-3 pb-24 pt-4 sm:px-6 sm:pt-7 lg:pb-12">{children}</main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {NAV.filter((n) => n.mobile).map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-muted-foreground"
              activeProps={{ className: "!text-primary" }}
            >
              <n.icon className="size-5" aria-hidden />
              {t(n.label)}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-muted-foreground",
              ["/devices", "/caregiver", "/settings"].includes(pathname) && "text-primary",
            )}
          >
            <Menu className="size-5" aria-hidden />
            {t("navMore")}
          </button>
        </nav>

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl pb-10">
            <SheetHeader>
              <SheetTitle className="text-2xl">{t("navMore")}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4">
              <BoxSwitcher />
              <NavLinks onNavigate={() => setMoreOpen(false)} />
              <button
                type="button"
                onClick={signOut}
                className="flex h-14 items-center gap-4 rounded-2xl px-4 text-lg font-semibold text-muted-foreground hover:bg-accent"
              >
                <LogOut className="size-6" aria-hidden /> {t("signOut")}
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
