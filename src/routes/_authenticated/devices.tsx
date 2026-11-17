import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { BatteryMedium, Bell, Copy, Cpu, FlaskConical, KeyRound, Lightbulb, Plus, Trash2, Wifi } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConnectionPill, LastSeen } from "@/components/hardware-status";
import { EmptyState, PageHeader, SimBadge } from "@/components/med-ui";
import { MqttSetup } from "@/components/mqtt-setup";
import { useMqttSession } from "@/lib/mqtt-session";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useActiveBox } from "@/lib/active-box";
import { registerRealDevice, rotateDeviceKey } from "@/lib/devices.functions";
import { useI18n, type DictKey } from "@/lib/i18n";
import { deviceConnection, toDateKey, type Device, type DeviceEvent, type DeviceStatusPayload } from "@/lib/medication";
import { useConfirmDose, useDeviceEvents, useDevices, useDoses, useNow } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/devices")({
  head: () => ({
    meta: [
      { title: "Reminder box — Smart Medicine Reminder Box" },
      { name: "description", content: "Connect the ESP32 medicine box and see its light, sound and compartment status." },
      { property: "og:title", content: "Reminder box — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Connect the ESP32 medicine box and see its light, sound and compartment status." },
    ],
  }),
  component: DevicesPage,
});

type DeviceCredentials = { deviceId: string; key: string };

function DevicesPage() {
  const { t } = useI18n();
  const { ownerId, isOwn } = useActiveBox();
  const qc = useQueryClient();
  const devices = useDevices(ownerId);
  const events = useDeviceEvents(ownerId);
  const now = useNow(15_000);
  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState<DeviceCredentials | null>(null);
  const [toRemove, setToRemove] = useState<Device | null>(null);

  const real = (devices.data ?? []).filter((d) => d.mode === "real");
  const sims = (devices.data ?? []).filter((d) => d.mode === "simulated");

  async function addSim() {
    const { error } = await supabase.from("devices").insert({
      owner_id: ownerId,
      name: t("simulated") + " · Demo",
      mode: "simulated",
      last_status: { led: "off", buzzer: "off", compartments: [1, 2, 3, 4].map((n) => ({ number: n, open: false, has_pills: true })) },
    });
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  async function remove() {
    if (!toRemove) return;
    const { error } = await supabase.from("devices").delete().eq("id", toRemove.id);
    if (error) toast.error(error.message);
    setToRemove(null);
    qc.invalidateQueries({ queryKey: ["devices"] });
  }

  return (
    <div className="space-y-10">
      <PageHeader
        title={t("devices")}
        body={t("devicesBody")}
        action={
          isOwn && (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" onClick={() => setAddOpen(true)}>
                <Plus aria-hidden /> {t("addRealDevice")}
              </Button>
              <Button size="lg" variant="sim" onClick={addSim}>
                <FlaskConical aria-hidden /> {t("addSimDevice")}
              </Button>
            </div>
          )
        }
      />

      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-2xl font-bold">
          <Cpu className="size-6 text-primary" aria-hidden /> {t("realDevice")}
        </h2>
        {real.length === 0 ? (
          <EmptyState icon={<Cpu className="size-8" />} title={t("hwNotConfigured")} />
        ) : (
          real.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              now={now}
              events={(events.data ?? []).filter((e) => e.device_id === d.id)}
              canManage={isOwn}
              onRemove={() => setToRemove(d)}
              onNewKey={setNewKey}
            />
          ))
        )}
      </section>

      {sims.length > 0 && (
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <FlaskConical className="size-6 text-sim" aria-hidden /> {t("simulated")}
          </h2>
          {sims.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              now={now}
              events={(events.data ?? []).filter((e) => e.device_id === d.id)}
              canManage={isOwn}
              onRemove={() => setToRemove(d)}
            />
          ))}
        </section>
      )}

      <AddRealDialog open={addOpen} onOpenChange={setAddOpen} onCreated={setNewKey} />
      <KeyDialog keyValue={newKey} onClose={() => setNewKey(null)} />

      <AlertDialog open={!!toRemove} onOpenChange={(o) => !o && setToRemove(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl">{t("removeDevice")}</AlertDialogTitle>
            <AlertDialogDescription className="text-lg">{t("removeDeviceConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 text-base">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-12 bg-destructive text-base text-destructive-foreground hover:bg-destructive/90" onClick={remove}>
              {t("remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeviceCard({
  device,
  now,
  events,
  canManage,
  onRemove,
  onNewKey,
}: {
  device: Device;
  now: Date;
  events: DeviceEvent[];
  canManage: boolean;
  onRemove: () => void;
  onNewKey?: (credentials: DeviceCredentials) => void;
}) {
  const { t } = useI18n();
  const isSim = device.mode === "simulated";
  const conn = deviceConnection(device, now);
  const { testContacts } = useMqttSession();
  const tested = conn === "awaiting_first_contact" && testContacts[device.id] === true;
  const status = (device.last_status ?? {}) as DeviceStatusPayload;
  const hasStatus = isSim || !!device.first_contact_at;
  const rotate = useServerFn(rotateDeviceKey);

  return (
    <article className={cn("rounded-3xl border bg-card p-6 shadow-soft", isSim && "border-dashed border-sim sim-stripes")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-bold">{device.name}</h3>
          {isSim ? (
            <p className="text-base font-semibold text-sim-foreground">{t("simulatedNote")}</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
              {!tested && <LastSeen device={device} />}
              {device.key_prefix && <span>{t("deviceKey")}: {device.key_prefix}…</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isSim ? <SimBadge /> : <ConnectionPill conn={conn} testReceived={tested} />}
        </div>
      </div>

      {conn === "awaiting_first_contact" && (
        <p className={cn("mt-4 rounded-2xl p-4 text-base", tested ? "bg-secondary text-secondary-foreground" : "bg-pending-soft text-pending-foreground")}>
          {t(tested ? "hwMqttTestReceivedBody" : "hwAwaitingBody")}
        </p>
      )}

      {hasStatus ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Indicator icon={<Lightbulb />} label={t("led")} value={status.led ? t(status.led as DictKey) : "—"} on={status.led === "on" || status.led === "blinking"} />
            <Indicator icon={<Bell />} label={t("buzzer")} value={status.buzzer ? t(status.buzzer as DictKey) : "—"} on={status.buzzer === "on"} />
            <Indicator icon={<Wifi />} label={t("wifi")} value={status.wifi_rssi != null ? `${status.wifi_rssi} dBm` : "—"} />
            <Indicator icon={<BatteryMedium />} label={t("battery")} value={status.battery != null ? `${status.battery}%` : "—"} />
          </div>
          <h4 className="mt-6 text-lg font-bold">{t("compartments")}</h4>
          {status.compartments?.length ? (
            <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8">
              {status.compartments.map((c) => (
                <div
                  key={c.number}
                  className={cn(
                    "flex flex-col items-center rounded-2xl border-2 p-3 text-center",
                    c.open ? "border-pending bg-pending-soft" : "border-border bg-card",
                  )}
                >
                  <span className="text-xl font-bold">#{c.number}</span>
                  <span className="text-sm font-semibold">{c.open ? t("open") : t("closed")}</span>
                  {c.has_pills != null && <span className="text-xs text-muted-foreground">{c.has_pills ? t("hasPills") : t("empty")}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-base text-muted-foreground">—</p>
          )}
          {device.firmware && <p className="mt-4 text-sm text-muted-foreground">{t("firmware")}: {device.firmware}</p>}
        </>
      ) : (
        <p className="mt-4 text-base text-muted-foreground">{t("noStatusYet")}</p>
      )}

      {isSim && canManage && <SimulatorControls device={device} status={status} />}
      {!isSim && canManage && <MqttSetup deviceId={device.id} ownerId={device.owner_id} />}

      <h4 className="mt-6 text-lg font-bold">{t("recentEvents")}</h4>
      {events.length === 0 ? (
        <p className="text-base text-muted-foreground">{t("noEvents")}</p>
      ) : (
        <ul className="mt-2 divide-y rounded-2xl border bg-card">
          {events.slice(0, 8).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-base">
              <span className="font-semibold">
                {e.event_type.replace(/_/g, " ")}
                {typeof (e.payload as Record<string, Json>)?.["medicine"] === "string" && ` · ${(e.payload as Record<string, string>)["medicine"]}`}
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                {e.source === "simulated" && <SimBadge className="py-0 text-xs" />}
                {format(new Date(e.created_at), "d MMM HH:mm")}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-6 flex flex-wrap gap-2">
          {!isSim && onNewKey && (
            <Button
              variant="soft"
              onClick={async () => {
                try {
                  const r = await rotate({ data: { deviceId: device.id } });
                  onNewKey({ deviceId: device.id, key: r.key });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <KeyRound aria-hidden /> {t("rotateKey")}
            </Button>
          )}
          <Button variant="ghost" onClick={onRemove}>
            <Trash2 aria-hidden /> {t("removeDevice")}
          </Button>
        </div>
      )}
    </article>
  );
}

function Indicator({ icon, label, value, on }: { icon: ReactNode; label: string; value: string; on?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl p-4", on ? "bg-taken-soft text-taken-foreground" : "bg-muted")}>
      <span className="[&_svg]:size-6">{icon}</span>
      <div>
        <p className="text-sm font-semibold opacity-80">{label}</p>
        <p className="text-lg font-bold">{value}</p>
      </div>
    </div>
  );
}

function SimulatorControls({ device, status }: { device: Device; status: DeviceStatusPayload }) {
  const { t } = useI18n();
  const { ownerId, userId } = useActiveBox();
  const qc = useQueryClient();
  const now = useNow();
  const { doses } = useDoses([ownerId], [toDateKey(now)], now);
  const confirm = useConfirmDose();
  const [draft, setDraft] = useState<DeviceStatusPayload>(status);
  useEffect(() => setDraft(status), [device.last_status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendStatus() {
    const payload = { ...draft, wifi_rssi: -55, battery: 87 };
    const ts = new Date().toISOString();
    const { error } = await supabase
      .from("devices")
      .update({ last_status: payload as unknown as Json, last_seen_at: ts, first_contact_at: device.first_contact_at ?? ts, firmware: "sim-1.0" })
      .eq("id", device.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase.from("device_events").insert({ device_id: device.id, owner_id: ownerId, event_type: "status_changed", payload: payload as unknown as Json, source: "simulated" });
    qc.invalidateQueries({ queryKey: ["devices"] });
    qc.invalidateQueries({ queryKey: ["device_events"] });
  }

  async function simulateTaken() {
    const next = doses.find((d) => d.status !== "taken" && !d.medicine.device_id && !d.schedule.box_slot);
    if (!next) {
      toast.info(t("simNothingDue"));
      return;
    }
    confirm.mutate(
      { dose: next, userId, source: "simulated", deviceId: device.id },
      {
        onSuccess: async () => {
          await supabase.from("device_events").insert({
            device_id: device.id,
            owner_id: ownerId,
            event_type: "dose_confirmed",
            payload: { medicine: next.medicine.name, compartment: next.medicine.compartment, slot: next.schedule.slot },
            source: "simulated",
          });
          qc.invalidateQueries({ queryKey: ["device_events"] });
          toast.success(`${next.medicine.name} — ${t("taken")} (${t("simulated")})`);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  }

  const comps = draft.compartments ?? [];
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-sim bg-card p-5">
      <h4 className="flex items-center gap-2 text-lg font-bold text-sim-foreground">
        <FlaskConical className="size-5" aria-hidden /> {t("simControls")}
      </h4>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["off", "on", "blinking"] as const).map((v) => (
          <Button key={v} size="sm" variant={draft.led === v ? "default" : "outline"} onClick={() => setDraft({ ...draft, led: v })}>
            <Lightbulb aria-hidden /> {t(v)}
          </Button>
        ))}
        {(["off", "on"] as const).map((v) => (
          <Button key={v} size="sm" variant={draft.buzzer === v ? "default" : "outline"} onClick={() => setDraft({ ...draft, buzzer: v })}>
            <Bell aria-hidden /> {t(v)}
          </Button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {comps.map((c) => (
          <Button
            key={c.number}
            size="sm"
            variant={c.open ? "default" : "outline"}
            onClick={() => setDraft({ ...draft, compartments: comps.map((x) => (x.number === c.number ? { ...x, open: !x.open } : x)) })}
          >
            #{c.number} {c.open ? t("open") : t("closed")}
          </Button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="sim" onClick={sendStatus}>
          {t("simSendStatus")}
        </Button>
        <Button variant="sim" onClick={simulateTaken} disabled={confirm.isPending}>
          {t("simConfirmNext")}
        </Button>
      </div>
    </div>
  );
}

function AddRealDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (credentials: DeviceCredentials) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const register = useServerFn(registerRealDevice);
  const [name, setName] = useState("ESP32");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{t("addRealDevice")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await register({ data: { name } });
              onOpenChange(false);
              onCreated(r);
              qc.invalidateQueries({ queryKey: ["devices"] });
            } catch (err) {
              toast.error((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="dname" className="text-base font-semibold">
              {t("deviceName")}
            </Label>
            <Input id="dname" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="h-12 text-lg" />
          </div>
          <DialogFooter>
            <Button type="submit" size="lg" disabled={busy}>
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function KeyDialog({ keyValue, onClose }: { keyValue: DeviceCredentials | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open={!!keyValue} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{t("deviceKey")}</DialogTitle>
        </DialogHeader>
        <p className="rounded-2xl bg-pending-soft p-4 text-base font-semibold text-pending-foreground">{t("deviceKeyOnce")}</p>
        <code className="block break-all rounded-2xl bg-muted p-4 font-mono text-base">{keyValue?.key}</code>
        <div className="space-y-1">
          <p className="font-semibold">{t("mqttBoxCode")}</p>
          <code className="block select-all break-all text-sm text-muted-foreground">{keyValue?.deviceId}</code>
        </div>
        <DialogFooter>
          <Button
            size="lg"
            onClick={() => {
              if (keyValue) navigator.clipboard.writeText(keyValue.key);
              toast.success(t("copied"));
            }}
          >
            <Copy aria-hidden /> {t("copy")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
