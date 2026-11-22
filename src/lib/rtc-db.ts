import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type RtcDatabase = {
  public: Database["public"] & {
    Functions: {
      save_six_box_medicine: {
        Args: { _medicine_id: string | null; _medicine: Json; _rounds: Json };
        Returns: string;
      };
      set_box_channel_schedule: {
        Args: { _device_id: string; _box_slot: string; _time: string };
        Returns: undefined;
      };
      confirm_box_compartment: {
        Args: { _device_id: string; _compartment: number; _date: string };
        Returns: number;
      };
    };
  };
};
export function rtcDb(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<RtcDatabase>;
}
