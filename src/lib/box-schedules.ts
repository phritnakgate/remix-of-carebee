import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { BoxSlot } from "./medication";
import { rtcDb } from "./rtc-db";

export function useBoxScheduleSupport() {
  return useQuery({
    queryKey: ["box-schedule-version"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("box_schedule_version");
      if (error?.code === "PGRST202" || error?.code === "42883") return false;
      if (error) throw error;
      return data === 1;
    },
  });
}

export async function saveBoxMedicine(input: {
  medicineId?: string;
  medicine: Database["public"]["Tables"]["medicines"]["Insert"] & { device_id: string | null };
  rounds: { box_slot: BoxSlot; dose_time: string }[];
}) {
  const { error } = await rtcDb(supabase).rpc("save_six_box_medicine", {
    // The SQL uses NULL for a new medicine. The generated RPC type omits that case.
    _medicine_id: input.medicineId ?? null,
    _medicine: input.medicine,
    _rounds: input.rounds,
  });
  if (error) throw error;
}
