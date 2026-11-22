import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Pill, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, MED_COLORS, PageHeader, fmtTime, medColorClass } from "@/components/med-ui";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBox } from "@/lib/active-box";
import { saveBoxMedicine, useBoxScheduleSupport } from "@/lib/box-schedules";
import { useI18n, type DictKey } from "@/lib/i18n";
import {
  DEFAULT_SLOT_TIMES,
  BOX_ROUNDS,
  BOX_SLOTS,
  scheduleSlotLabel,
  TIME_SLOTS,
  type BoxSlot,
  type FoodInstruction,
  type Medicine,
  type Schedule,
  type TimeSlot,
} from "@/lib/medication";
import { useDevices, useMedicines, useSchedules } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/medicines")({
  head: () => ({
    meta: [
      { title: "Medicines — Smart Medicine Reminder Box" },
      { name: "description", content: "Add, edit and remove medicines with dose, quantity and food instructions." },
      { property: "og:title", content: "Medicines — Smart Medicine Reminder Box" },
      { property: "og:description", content: "Add, edit and remove medicines with dose, quantity and food instructions." },
    ],
  }),
  component: MedicinesPage,
});

const FOODS: FoodInstruction[] = ["before_food", "after_food", "with_food", "any"];
const LOW_STOCK_DAYS = 3;

interface FormState {
  id?: string;
  name: string;
  dosage: string;
  quantity: number;
  pills_per_dose: number;
  food_instruction: FoodInstruction;
  compartment: string;
  color: string;
  notes: string;
  active: boolean;
  slots: TimeSlot[];
  boxId: string;
  rounds: Partial<Record<BoxSlot, string>>;
}

const emptyForm: FormState = {
  name: "",
  dosage: "",
  quantity: 30,
  pills_per_dose: 1,
  food_instruction: "after_food",
  compartment: "none",
  color: "blue",
  notes: "",
  active: true,
  slots: ["morning"],
  boxId: "none",
  rounds: { morning_after: BOX_ROUNDS.morning_after.time },
};

function MedicinesPage() {
  const { t } = useI18n();
  const { ownerId } = useActiveBox();
  const qc = useQueryClient();
  const meds = useMedicines([ownerId]);
  const scheds = useSchedules([ownerId]);
  const schema = useBoxScheduleSupport();
  const managed = schema.data === true;
  const boxes = (useDevices(ownerId).data ?? []).filter((device) => device.mode === "real");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Medicine | null>(null);

  const schedulesFor = (id: string) => (scheds.data ?? []).filter((s) => s.medicine_id === id && !s.ends_on);
  function channelTime(boxId: string, slot: BoxSlot) {
    const medicineIds = new Set((meds.data ?? []).filter((m) => m.device_id === boxId && m.active).map((m) => m.id));
    return (scheds.data ?? []).find((s) => medicineIds.has(s.medicine_id) && s.box_slot === slot && !s.ends_on)?.dose_time.slice(0, 5);
  }

  function openEdit(m: Medicine) {
    const schedules = schedulesFor(m.id);
    const rounds: FormState["rounds"] = {};
    const ordered = [...schedules].sort((a, b) =>
      Number(!!b.box_slot) - Number(!!a.box_slot) ||
      Date.parse(a.created_at) - Date.parse(b.created_at) ||
      a.id.localeCompare(b.id),
    );
    for (const schedule of ordered) {
      const legacy = schedule.slot === "bedtime" ? "bedtime" : `${schedule.slot}_${m.food_instruction === "before_food" ? "before" : "after"}` as const;
      const slot = schedule.box_slot ?? legacy;
      rounds[slot] ??= fmtTime(schedule.dose_time);
    }
    setForm({
      id: m.id,
      name: m.name,
      dosage: m.dosage ?? "",
      quantity: m.quantity,
      pills_per_dose: m.pills_per_dose,
      food_instruction: m.food_instruction,
      compartment: m.compartment ? String(m.compartment) : "none",
      color: m.color,
      notes: m.notes ?? "",
      active: m.active,
      slots: schedules.map((s) => s.slot),
      boxId: m.device_id ?? "none",
      rounds,
    });
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return;
    const rounds = BOX_SLOTS.flatMap((box_slot) => {
      const dose_time = form.rounds[box_slot];
      return dose_time ? [{ box_slot, dose_time }] : [];
    });
    if (managed ? !rounds.length : !form.slots.length) {
      toast.error(t("pickOneSlot"));
      return;
    }
    setSaving(true);
    try {
      const row = {
        owner_id: ownerId,
        name: form.name.trim(),
        dosage: form.dosage.trim() || null,
        quantity: Math.max(0, Math.floor(form.quantity) || 0),
        pills_per_dose: Math.max(1, Math.floor(form.pills_per_dose) || 1),
        food_instruction: form.food_instruction,
        compartment: form.compartment === "none" ? null : Number(form.compartment),
        color: form.color,
        notes: form.notes.trim() || null,
        active: form.active,
      };
      if (managed) {
        await saveBoxMedicine({
          ...(form.id ? { medicineId: form.id } : {}),
          medicine: { ...row, device_id: form.boxId === "none" ? null : form.boxId },
          rounds,
        });
      } else {
        let medId = form.id;
        if (medId) {
          const { error } = await supabase.from("medicines").update(row).eq("id", medId);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from("medicines").insert(row).select("id").single();
          if (error) throw error;
          medId = data.id;
        }
        const existing: Schedule[] = schedulesFor(medId);
        const toAdd = form.slots.filter((s) => !existing.some((e) => e.slot === s));
        const toRemove = existing.filter((e) => !form.slots.includes(e.slot));
        if (toAdd.length) {
          const { error } = await supabase.from("medication_schedules").insert(
            toAdd.map((slot) => ({ owner_id: ownerId, medicine_id: medId!, slot, dose_time: DEFAULT_SLOT_TIMES[slot] })),
          );
          if (error) throw error;
        }
        if (toRemove.length) {
          const { error } = await supabase.from("medication_schedules").delete().in("id", toRemove.map((r) => r.id));
          if (error) throw error;
        }
      }
      toast.success(t("saved"));
      setForm(null);
      qc.invalidateQueries({ queryKey: ["medicines"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      window.dispatchEvent(new Event("carebee-schedule-changed"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    const { error } = await supabase.from("medicines").delete().eq("id", toDelete.id);
    if (error) toast.error(error.message);
    else toast.success(t("deleted"));
    setToDelete(null);
    qc.invalidateQueries({ queryKey: ["medicines"] });
    qc.invalidateQueries({ queryKey: ["schedules"] });
    window.dispatchEvent(new Event("carebee-schedule-changed"));
  }

  return (
    <div>
      <PageHeader
        title={t("medicines")}
        action={
          <Button size="lg" disabled={schema.isPending || schema.isError} onClick={() => setForm({ ...emptyForm })}>
            <Plus aria-hidden /> {t("addMedicine")}
          </Button>
        }
      />

      {schema.isError && <p className="mb-3 text-sm text-destructive">{t("boxScheduleLoadFailed")}</p>}

      {meds.isLoading ? (
        <p className="text-lg text-muted-foreground">{t("loading")}</p>
      ) : (meds.data ?? []).length === 0 ? (
        <EmptyState icon={<Pill className="size-8" />} title={t("noMedicines")} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {meds.data!.map((m) => {
            const s = schedulesFor(m.id);
            const perDay = s.length * m.pills_per_dose;
            const low = perDay > 0 && m.quantity < perDay * LOW_STOCK_DAYS;
            return (
              <article key={m.id} className={cn("flex min-w-0 flex-col gap-3 rounded-2xl border bg-card p-3.5 sm:p-4 shadow-soft", !m.active && "opacity-60")}>
                <div className="flex items-start gap-2.5">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-primary-foreground", medColorClass[m.color])}>
                    <Pill className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-bold sm:text-xl">{m.name}</h2>
                    <p className="text-base text-muted-foreground">
                      {[m.dosage, `${m.pills_per_dose} ${t("pills")}`, !managed && t(`food_${m.food_instruction}` as DictKey)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {!m.active && <span className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">{t("inactive")}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.map((x) => (
                    <span key={x.id} className="rounded-full bg-primary-soft px-2.5 py-1 text-sm font-semibold text-accent-foreground">
                      {t(scheduleSlotLabel(x))} {fmtTime(x.dose_time)}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span>
                    {t("quantity")}: <strong className="tabular-nums">{m.quantity}</strong>
                  </span>
                  {managed ? (
                    <span>{t("medicineBox")} <strong>{boxes.find((box) => box.id === m.device_id)?.name ?? t("unassignedBox")}</strong></span>
                  ) : m.compartment && (
                    <span>
                      {t("compartment")}: <strong>#{m.compartment}</strong>
                    </span>
                  )}
                  {low && (
                    <span className="inline-flex items-center gap-1 font-semibold text-pending-foreground">
                      <AlertTriangle className="size-5" aria-hidden /> {t("lowStock")}
                    </span>
                  )}
                </div>
                {m.notes && <p className="rounded-2xl bg-muted p-3 text-base">{m.notes}</p>}
                <div className="mt-auto flex gap-2">
                  <Button variant="soft" disabled={schema.isPending || schema.isError || scheds.isPending || scheds.isError} onClick={() => openEdit(m)}>
                    <Pencil aria-hidden /> {t("edit")}
                  </Button>
                  <Button variant="ghost" onClick={() => setToDelete(m)} aria-label={`${t("delete")} ${m.name}`}>
                    <Trash2 aria-hidden /> {t("delete")}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-2xl">{form?.id ? t("editMedicine") : t("addMedicine")}</DialogTitle>
          </DialogHeader>
          {form && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <Field label={t("name")} id="name">
                <Input id="name" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 text-base" />
              </Field>
              <div className="grid grid-cols-2 gap-2.5">
                <Field label={t("dosage")} id="dosage">
                  <Input id="dosage" maxLength={40} placeholder={t("dosagePlaceholder")} value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} className="h-11 text-base" />
                </Field>
                <Field label={t("pillsPerDose")} id="ppd">
                  <Input id="ppd" type="number" min={1} max={20} value={form.pills_per_dose} onChange={(e) => setForm({ ...form, pills_per_dose: Number(e.target.value) })} className="h-11 text-base" />
                </Field>
                <Field label={t("quantity")} id="qty">
                  <Input id="qty" type="number" min={0} max={9999} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} className="h-11 text-base" />
                </Field>
                {managed ? (
                  <Field label={t("medicineBox")} id="medicine-box">
                    <Select value={form.boxId} onValueChange={(boxId) => setForm({
                      ...form, boxId,
                      rounds: Object.fromEntries(Object.entries(form.rounds).map(([slot, time]) =>
                        [slot, channelTime(boxId, slot as BoxSlot) ?? time],
                      )),
                    })}>
                      <SelectTrigger id="medicine-box" className="h-12"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("unassignedBox")}</SelectItem>
                        {boxes.map((box) => <SelectItem key={box.id} value={box.id}>{box.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {form.boxId === "none" && <p className="text-xs text-muted-foreground">{t("unassignedBoxHint")}</p>}
                  </Field>
                ) : <Field label={t("compartment")} id="comp">
                  <Select value={form.compartment} onValueChange={(v) => setForm({ ...form, compartment: v })}>
                    <SelectTrigger id="comp" className="h-11 text-base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("compartmentNone")}</SelectItem>
                      {Array.from({ length: 8 }, (_, i) => (
                        <SelectItem key={i} value={String(i + 1)}>
                          #{i + 1}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>}
              </div>

              {managed ? (
                <fieldset className="space-y-2">
                  <legend className="mb-2 font-semibold">{t("whenToTake")}</legend>
                  <p className="text-sm text-muted-foreground">{t("rtcSharedTime")}</p>
                  {BOX_SLOTS.filter((slot) => slot !== "bedtime" || form.rounds.bedtime !== undefined).map((slot) => {
                    const time = form.rounds[slot];
                    const label = t(`round_${slot}`);
                    return (
                      <div key={slot} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-1">
                        <label className="flex min-h-9 flex-1 items-center gap-2 text-sm font-medium">
                          <input type="checkbox" checked={time !== undefined} onChange={(event) => {
                            const rounds = { ...form.rounds };
                            if (event.target.checked) rounds[slot] = channelTime(form.boxId, slot) ?? BOX_ROUNDS[slot].time;
                            else delete rounds[slot];
                            setForm({ ...form, rounds });
                          }} />
                          {label}
                        </label>
                        {time !== undefined && <Input type="time" required aria-label={`${label} ${t("time")}`} className="w-28" value={time} onChange={(event) => setForm({ ...form, rounds: { ...form.rounds, [slot]: event.target.value } })} />}
                      </div>
                    );
                  })}
                </fieldset>
              ) : <>
              <fieldset>
                <legend className="mb-2 text-base font-semibold">{t("whenToTake")}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TIME_SLOTS.map((slot) => {
                    const on = form.slots.includes(slot);
                    return (
                      <button
                        key={slot}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm({ ...form, slots: on ? form.slots.filter((s) => s !== slot) : [...form.slots, slot] })}
                        className={cn(
                          "flex h-12 flex-col items-center justify-center rounded-2xl border-2 text-base font-semibold transition-colors",
                          on ? "border-primary bg-primary-soft text-accent-foreground" : "border-border text-muted-foreground",
                        )}
                      >
                        {t(`slot_${slot}` as DictKey)}
                        <span className="text-sm font-normal">{DEFAULT_SLOT_TIMES[slot]}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-2 text-base font-semibold">{t("foodInstruction")}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {FOODS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={form.food_instruction === f}
                      onClick={() => setForm({ ...form, food_instruction: f })}
                      className={cn(
                        "h-12 rounded-2xl border-2 text-base font-semibold",
                        form.food_instruction === f ? "border-taken bg-taken-soft text-taken-foreground" : "border-border text-muted-foreground",
                      )}
                    >
                      {t(`food_${f}` as DictKey)}
                    </button>
                  ))}
                </div>
              </fieldset>
              </>}

              <fieldset>
                <legend className="mb-2 text-base font-semibold">{t("color")}</legend>
                <div className="flex flex-wrap gap-2">
                  {MED_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      aria-pressed={form.color === c}
                      onClick={() => setForm({ ...form, color: c })}
                      className={cn("size-11 rounded-full ring-offset-2", medColorClass[c], form.color === c && "ring-4 ring-ring")}
                    />
                  ))}
                </div>
              </fieldset>

              <Field label={t("notes")} id="notes">
                <Textarea id="notes" maxLength={300} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="text-base" />
              </Field>

              <label className="flex items-center justify-between rounded-xl bg-muted p-3 text-base font-semibold">
                {t("active")}
                <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
              </label>

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" size="lg" onClick={() => setForm(null)}>
                  {t("cancel")}
                </Button>
                <Button type="submit" size="lg" disabled={saving}>
                  {t("save")}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-2xl">{t("deleteMedicine")}: {toDelete?.name}</AlertDialogTitle>
            <AlertDialogDescription className="text-lg">{t("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-12 text-base">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-12 bg-destructive text-base text-destructive-foreground hover:bg-destructive/90" onClick={remove}>
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-base font-semibold">
        {label}
      </Label>
      {children}
    </div>
  );
}
