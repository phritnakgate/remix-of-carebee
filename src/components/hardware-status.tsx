import { formatDistanceToNow } from "date-fns";
import { Cpu, Wifi, WifiOff, Hourglass, Plug } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { SimBadge, useDateFns } from "@/components/med-ui";
import { useI18n } from "@/lib/i18n";
import { deviceConnection, type Device, type DeviceConnection } from "@/lib/medication";
import { useMqttSession } from "@/lib/mqtt-session";
import { cn } from "@/lib/utils";

export function ConnectionPill({ conn, testReceived }: { conn: DeviceConnection; testReceived?: boolean }) {
  const { t } = useI18n();
  if (conn === "simulated") return <SimBadge />;
  const map = {
    online: { label: t("hwOnline"), cls: "bg-taken-soft text-taken-foreground", Icon: Wifi },
    offline: { label: t("hwOffline"), cls: "bg-missed-soft text-missed-foreground", Icon: WifiOff },
    awaiting_first_contact: testReceived
      ? { label: t("hwMqttTestReceived"), cls: "bg-secondary text-secondary-foreground", Icon: Wifi }
      : { label: t("hwAwaiting"), cls: "bg-pending-soft text-pending-foreground", Icon: Hourglass },
  }[conn];
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold", map.cls)}>
      {conn === "online" ? <span className="size-2.5 rounded-full bg-online pulse-dot" /> : <map.Icon className="size-4" aria-hidden />}
      {map.label}
    </span>
  );
}

export function LastSeen({ device }: { device: Device }) {
  const { t } = useI18n();
  const locale = useDateFns();
  return (
    <span className="text-sm text-muted-foreground">
      {t("lastSeen")}:{" "}
      {device.last_seen_at ? formatDistanceToNow(new Date(device.last_seen_at), { addSuffix: true, locale }) : t("never")}
    </span>
  );
}

/** Dashboard summary. Real and simulated boxes are always shown separately. */
export function HardwareSummary({ devices, now }: { devices: Device[]; now: Date }) {
  const { t } = useI18n();
  const { testContacts } = useMqttSession();
  const real = devices.filter((d) => d.mode === "real");
  const sims = devices.filter((d) => d.mode === "simulated");
  return (
    <section className="rounded-3xl border bg-card p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Cpu className="size-6 text-primary" aria-hidden /> {t("hardware")}
        </h2>
        <Link to="/devices" className="text-base font-semibold text-primary hover:underline">
          {t("viewDetails")}
        </Link>
      </div>
      {real.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl bg-muted p-4">
          <Plug className="mt-0.5 size-6 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-lg font-semibold">{t("hwNotConfigured")}</p>
            <p className="text-base text-muted-foreground">{t("hwNotConfiguredBody")}</p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {real.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-muted p-4">
              <div>
                <p className="text-lg font-semibold">{d.name}</p>
                {(!testContacts[d.id] || d.first_contact_at) && <LastSeen device={d} />}
              </div>
              <ConnectionPill conn={deviceConnection(d, now)} testReceived={testContacts[d.id] === true} />
            </li>
          ))}
        </ul>
      )}
      {sims.length > 0 && (
        <ul className="mt-3 space-y-3">
          {sims.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-dashed border-sim p-4 sim-stripes">
              <div>
                <p className="text-lg font-semibold">{d.name}</p>
                <p className="text-sm text-sim-foreground">{t("simulatedNote")}</p>
              </div>
              <SimBadge />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
