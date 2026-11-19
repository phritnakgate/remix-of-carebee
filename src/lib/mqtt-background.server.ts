import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { mqttPublicBrokers, mqttSettingsSchema } from "./mqtt";

export type BackgroundConfig = {
  device_id: string;
  owner_id: string;
  enabled: boolean;
  enabled_at: string;
  settings: Json;
  last_checked_at: string | null;
  last_published_at: string | null;
  last_error: string | null;
};

type BackgroundDatabase = {
  public: Database["public"] & {
    Tables: {
      mqtt_background_configs: {
        Row: BackgroundConfig;
        Insert: Partial<BackgroundConfig> &
          Pick<BackgroundConfig, "device_id" | "owner_id" | "settings">;
        Update: Partial<BackgroundConfig>;
        Relationships: [];
      };
      mqtt_job_state: {
        Row: {
          id: string;
          token_hash: string;
          last_tick_at: string | null;
          last_run_at: string | null;
        };
        Insert: { id: string; token_hash: string };
        Update: { last_run_at?: string; last_tick_at?: string };
        Relationships: [];
      };
    };
    Functions: {
      mqtt_due_boxes: { Args: Record<string, never>; Returns: { device_id: string }[] };
      claim_mqtt_delivery: {
        Args: {
          _device_id: string;
          _schedule_id: string;
          _date: string;
          _payload: string;
          _token: string;
          _settings: Json;
        };
        Returns: { payload: string }[];
      };
      finish_mqtt_delivery: {
        Args: {
          _device_id: string;
          _schedule_id: string;
          _date: string;
          _token: string;
          _success: boolean;
        };
        Returns: boolean;
      };
    };
  };
};

export function backgroundDb() {
  return supabaseAdmin as unknown as SupabaseClient<BackgroundDatabase>;
}

function missingSchema(error: { code: string } | null) {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

export async function getBackgroundConfig(deviceId: string) {
  const db = backgroundDb();
  const { data, error } = await db
    .from("mqtt_background_configs")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error && !missingSchema(error)) throw error;
  const state = error
    ? null
    : await db
        .from("mqtt_job_state")
        .select("last_tick_at,last_run_at")
        .eq("id", "default")
        .maybeSingle();
  if (state?.error && !missingSchema(state.error)) throw state.error;
  return {
    available: !error && !state?.error,
    config: data,
    lastTick: state?.data?.last_tick_at ?? null,
    lastRun: state?.data?.last_run_at ?? null,
  };
}

export async function backgroundEnabled(deviceId: string) {
  const { data, error } = await backgroundDb()
    .from("mqtt_background_configs")
    .select("enabled")
    .eq("device_id", deviceId)
    .maybeSingle();
  if (error && !missingSchema(error)) throw error;
  return data?.enabled === true;
}

export function backgroundSettings(input: unknown) {
  const settings = mqttSettingsSchema.parse(input);
  const allowed = Object.values(mqttPublicBrokers).some(
    (broker) =>
      broker.host === settings.host &&
      broker.websocketPort === settings.websocketPort &&
      broker.websocketPath === settings.websocketPath,
  );
  if (!allowed)
    throw new Error("Use the HiveMQ or EMQX public broker preset for background delivery");
  return settings;
}
