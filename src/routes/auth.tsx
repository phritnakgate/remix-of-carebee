import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Pill } from "lucide-react";

import { GoogleButton } from "@/components/google-button";
import { LangSwitch } from "@/components/lang-switch";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Smart Medicine Reminder Box" },
      { name: "description", content: "Sign in with Google to manage medicines, your ESP32 reminder box and caregiver alerts." },
      { property: "og:title", content: "Sign in — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Sign in with Google to manage medicines, your reminder box and caregiver alerts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen flex-col bg-hero">
      <header className="flex items-center justify-between px-5 py-4 sm:px-8">
        <Link to="/" className="flex items-center gap-3 font-bold">
          <span className="grid size-11 place-items-center rounded-2xl bg-brand text-primary-foreground">
            <Pill className="size-6" />
          </span>
          <span className="hidden text-lg sm:inline">{t("appName")}</span>
        </Link>
        <LangSwitch />
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-16">
        <div className="w-full max-w-md rounded-3xl border bg-card p-8 shadow-lift sm:p-10">
          <h1 className="text-3xl font-bold">{t("signInTitle")}</h1>
          <p className="mt-3 text-lg text-muted-foreground">{t("signInBody")}</p>
          <GoogleButton className="mt-8" />
        </div>
      </div>
    </main>
  );
}
