import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  expandDoses,
  toDateKey,
  type Device,
  type DeviceEvent,
  type Dose,
  type DoseLog,
  type Medicine,
  type Schedule,
} from "./medication";

type DoseSource = Database["public"]["Enums"]["dose_source"];

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useMedicines(ownerIds: string[]) {
  return useQuery({
    queryKey: ["medicines", ownerIds],
    enabled: ownerIds.length > 0,
    queryFn: async (): Promise<Medicine[]> => {
      const { data, error } = await supabase
        .from("medicines")
        .select("*")
        .in("owner_id", ownerIds)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useSchedules(ownerIds: string[]) {
  return useQuery({
    queryKey: ["schedules", ownerIds],
    enabled: ownerIds.length > 0,
    queryFn: async (): Promise<Schedule[]> => {
      const { data, error } = await supabase
        .from("medication_schedules")
        .select("*")
        .in("owner_id", ownerIds)
        .order("dose_time");
      if (error) throw error;
      return data;
    },
  });
}

export function useDoseLogs(ownerIds: string[], from: string, to: string) {
  return useQuery({
    queryKey: ["dose_logs", ownerIds, from, to],
    enabled: ownerIds.length > 0,
    queryFn: async (): Promise<DoseLog[]> => {
      const { data, error } = await supabase
        .from("dose_logs")
        .select("*")
        .in("owner_id", ownerIds)
        .gte("scheduled_date", from)
        .lte("scheduled_date", to);
      if (error) throw error;
      return data;
    },
  });
}

export function useDevices(ownerId: string) {
  return useQuery({
    queryKey: ["devices", ownerId],
    queryFn: async (): Promise<Device[]> => {
      const { data, error } = await supabase
        .from("devices")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
}

export function useDeviceEvents(ownerId: string) {
  return useQuery({
    queryKey: ["device_events", ownerId],
    queryFn: async (): Promise<DeviceEvent[]> => {
      const { data, error } = await supabase
        .from("device_events")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return data;
    },
  });
}

/** Doses for a set of owners on a list of dates, with derived statuses. */
export function useDoses(ownerIds: string[], dates: string[], now: Date) {
  const meds = useMedicines(ownerIds);
  const scheds = useSchedules(ownerIds);
  const logs = useDoseLogs(ownerIds, dates[0] ?? "", dates[dates.length - 1] ?? "");
  const ready = !!meds.data && !!scheds.data && !!logs.data;
  const doses: Dose[] = ready
    ? expandDoses({ dates, schedules: scheds.data!, medicines: meds.data!, logs: logs.data!, now })
    : [];
  return {
    doses,
    medicines: meds.data ?? [],
    isLoading: meds.isLoading || scheds.isLoading || logs.isLoading,
    error: meds.error || scheds.error || logs.error,
  };
}

const LIVE_TABLES = ["dose_logs", "devices", "device_events", "medicines", "medication_schedules"] as const;
const TABLE_KEYS: Record<(typeof LIVE_TABLES)[number], string> = {
  dose_logs: "dose_logs",
  devices: "devices",
  device_events: "device_events",
  medicines: "medicines",
  medication_schedules: "schedules",
};

/** Keeps every page in sync with the database and the ESP32 in real time. */
export function useLiveUpdates(ownerIds: string[]) {
  const qc = useQueryClient();
  const idsKey = ownerIds.join(",");
  useEffect(() => {
    if (!idsKey) return;
    const channels = idsKey.split(",").map((ownerId) => {
      let ch = supabase.channel(`box-${ownerId}-${Math.random().toString(36).slice(2)}`);
      for (const table of LIVE_TABLES) {
        ch = ch.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter: `owner_id=eq.${ownerId}` },
          () => qc.invalidateQueries({ queryKey: [TABLE_KEYS[table]] }),
        );
      }
      return ch.subscribe();
    });
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [idsKey, qc]);
}

export function useConfirmDose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { dose: Dose; userId: string; source?: DoseSource; deviceId?: string }) => {
      const { dose, userId } = args;
      const source: DoseSource = args.source ?? (dose.schedule.owner_id === userId ? "app" : "caregiver");
      const { error } = await supabase.from("dose_logs").insert({
        owner_id: dose.schedule.owner_id,
        schedule_id: dose.schedule.id,
        medicine_id: dose.medicine.id,
        scheduled_date: dose.date,
        slot: dose.schedule.slot,
        source,
        confirmed_by: userId,
        device_id: args.deviceId ?? null,
      });
      if (error) throw error;
      if (dose.medicine.quantity > 0) {
        await supabase
          .from("medicines")
          .update({ quantity: Math.max(0, dose.medicine.quantity - dose.medicine.pills_per_dose) })
          .eq("id", dose.medicine.id);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["dose_logs"] });
      qc.invalidateQueries({ queryKey: ["medicines"] });
    },
  });
}

export function useUndoDose() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dose: Dose) => {
      if (!dose.log) return;
      const { error } = await supabase.from("dose_logs").delete().eq("id", dose.log.id);
      if (error) throw error;
      await supabase
        .from("medicines")
        .update({ quantity: dose.medicine.quantity + dose.medicine.pills_per_dose })
        .eq("id", dose.medicine.id);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["dose_logs"] });
      qc.invalidateQueries({ queryKey: ["medicines"] });
    },
  });
}

export const todayKey = () => toDateKey(new Date());
