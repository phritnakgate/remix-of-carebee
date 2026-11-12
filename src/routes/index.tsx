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
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-brand text-primary-foreground">
            <Pill className="size-6" aria-hidden />
          </span>
          <span className="text-lg font-bold leading-tight">{t("appName")}</span>
        </div>
        <div className="flex items-center gap-3">
          <LangSwitch />
          <Button asChild variant="soft" className="hidden sm:inline-flex">
            <Link to="/auth">{t("signIn")}</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 sm:px-8 lg:grid-cols-2 lg:pt-12">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-base font-semibold text-secondary-foreground">
              <BellRing className="size-5" aria-hidden /> {t("tagline")}
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-tight sm:text-6xl">{t("heroTitle")}</h1>
            <p className="mt-6 max-w-xl text-xl text-muted-foreground">{t("heroBody")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="xl" variant="hero">
                <Link to="/auth">{t("getStarted")}</Link>
              </Button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 -z-10 rounded-[2.5rem] bg-hero" aria-hidden />
            <img
              src={heroImg}
              alt="Smart medicine reminder box with four compartments on a kitchen table"
              width={1280}
              height={960}
              className="aspect-[4/3] w-full rounded-[2rem] object-cover shadow-lift"
            />
          </div>
        </section>

        <section className="bg-hero py-16">
          <div className="mx-auto grid max-w-6xl gap-5 px-5 sm:px-8 md:grid-cols-3">
            {features.map((f) => (
              <article key={f.title} className="rounded-3xl bg-card p-7 shadow-soft">
                <span className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                  <f.icon className="size-7" aria-hidden />
                </span>
                <h2 className="mt-5 text-2xl font-bold">{f.title}</h2>
                <p className="mt-2 text-lg text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 py-8 text-base text-muted-foreground sm:px-8">{t("appName")}</footer>
    </div>
  );
}
