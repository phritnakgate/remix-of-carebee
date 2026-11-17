import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { BoxSlot } from "./medication";

export function useBoxScheduleSupport() {
  return useQuery({
    queryKey: ["box-schedule-version"],
    staleTime: 60_000,
    queryFn: async () => {
      // These RPCs appear in the generated types once Lovable applies the database change.
      const { data, error } = await supabase.rpc("box_schedule_version" as never);
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
  const { error } = await supabase.rpc(
    "save_box_medicine" as never,
    {
      _medicine_id: input.medicineId ?? null,
      _medicine: input.medicine,
      _rounds: input.rounds,
    } as never,
  );
  if (error) throw error;
}
