import { createFileRoute, Link } from "@tanstack/react-router";
import { BellRing, CalendarCheck, Cpu, HeartHandshake, Pill } from "lucide-react";

import heroImg from "@/assets/hero-medicine-box.jpg";
import { LangSwitch } from "@/components/lang-switch";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart Medicine Reminder Box — medication reminders for elderly family" },
      {
        name: "description",
        content: "Large-text medicine schedules, ESP32 reminder box integration and real-time caregiver alerts for elderly family members.",
      },
      { property: "og:title", content: "Smart Medicine Reminder Box" },
      {
        property: "og:description",
        content: "Large-text medicine schedules, ESP32 reminder box integration and real-time caregiver alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  const features = [
    { icon: CalendarCheck, title: t("featureSchedule"), body: t("featureScheduleBody") },
    { icon: Cpu, title: t("featureBox"), body: t("featureBoxBody") },
    { icon: HeartHandshake, title: t("featureFamily"), body: t("featureFamilyBody") },
  ];
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-primary-foreground">
            <Pill className="size-6" aria-hidden />
          </span>
          <span className="text-base font-bold leading-tight">{t("appName")}</span>
        </div>
        <div className="flex items-center gap-3">
          <LangSwitch />
          <Button asChild variant="soft" className="hidden sm:inline-flex">
            <Link to="/auth">{t("signIn")}</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-5 px-3 pb-8 pt-3 sm:px-6 lg:grid-cols-2 lg:gap-9 lg:pb-12 lg:pt-9">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground">
              <BellRing className="size-5" aria-hidden /> {t("tagline")}
            </span>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl xl:text-5xl">{t("heroTitle")}</h1>
            <p className="mt-3 max-w-xl text-base sm:text-lg text-muted-foreground">{t("heroBody")}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="lg" variant="hero">
                <Link to="/auth">{t("getStarted")}</Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-2 -z-10 rounded-[2.5rem] bg-hero" aria-hidden />
            <img
              src={heroImg}
              alt="Smart medicine reminder box with four compartments on a kitchen table"
              width={1280}
              height={960}
              className="aspect-[4/3] w-full rounded-2xl object-cover shadow-lift"
            />
          </div>
        </section>

        <section className="bg-hero py-7 sm:py-10">
          <div className="mx-auto grid max-w-7xl gap-3 px-3 sm:px-6 md:grid-cols-3">
            {features.map((f) => (
              <article key={f.title} className="rounded-2xl bg-card p-4 sm:p-5 shadow-soft">
                <span className="grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <h2 className="mt-3 text-xl font-bold">{f.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground sm:text-base">{f.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-3 py-5 text-sm text-muted-foreground sm:px-6">{t("appName")}</footer>
    </div>
  );
}
