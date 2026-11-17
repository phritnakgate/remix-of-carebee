import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

// The Lovable-managed contract is described in docs/admin-lovable-setup.md.
type TemplateDatabase = {
  public: Database["public"] & {
    Tables: Record<
      "mqtt_reminder_templates" | "mqtt_sensor_templates",
      {
        Row: { id: "default"; template: string };
        Insert: { id: "default"; template: string };
        Update: { template?: string };
        Relationships: [];
      }
    >;
  };
};

type TemplateKind = "reminder" | "sensor";

function templates(kind: TemplateKind) {
  return (supabaseAdmin as unknown as SupabaseClient<TemplateDatabase>).from(
    kind === "sensor" ? "mqtt_sensor_templates" : "mqtt_reminder_templates",
  );
}

function isMissingTable(error: { code: string }) {
  return error.code === "PGRST205" || error.code === "42P01";
}

export async function readSharedTemplate(kind: TemplateKind) {
  const { data, error } = await templates(kind)
    .select("template")
    .eq("id", "default")
    .maybeSingle();
  if (error && !isMissingTable(error)) throw error;
  return { available: !error, template: data?.template ?? "" };
}

export async function writeSharedTemplate(kind: TemplateKind, template: string) {
  const { error } = template
    ? await templates(kind).upsert({ id: "default", template })
    : await templates(kind).delete().eq("id", "default");
  if (error && !isMissingTable(error)) throw error;
  return !error;
}
