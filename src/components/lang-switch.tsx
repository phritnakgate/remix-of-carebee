import { useI18n, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  const options: { value: Lang; label: string }[] = [
    { value: "th", label: "ไทย" },
    { value: "en", label: "EN" },
  ];
  return (
    <div role="group" aria-label={t("language")} className={cn("inline-flex rounded-xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={lang === o.value}
          onClick={() => setLang(o.value)}
          className={cn(
            "h-9 min-w-12 rounded-lg px-3 text-sm font-semibold transition-colors",
            lang === o.value ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
