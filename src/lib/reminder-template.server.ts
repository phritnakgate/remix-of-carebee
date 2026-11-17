import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

// The Lovable-managed contract is described in docs/admin-lovable-setup.md.
type TemplateDatabase = {
  public: Database["public"] & {
    Tables: {
      mqtt_reminder_templates: {
        Row: { id: "default"; template: string };
        Insert: { id: "default"; template: string };
        Update: { template?: string };
        Relationships: [];
      };
    };
  };
};

function templates() {
  return (supabaseAdmin as unknown as SupabaseClient<TemplateDatabase>).from(
    "mqtt_reminder_templates",
  );
}

function isMissingTable(error: { code: string }) {
  return error.code === "PGRST205" || error.code === "42P01";
}

export async function readSharedReminderTemplate() {
  const { data, error } = await templates().select("template").eq("id", "default").maybeSingle();
  if (error && !isMissingTable(error)) throw error;
  return { available: !error, template: data?.template ?? "" };
}

export async function writeSharedReminderTemplate(template: string) {
  const { error } = template
    ? await templates().upsert({ id: "default", template })
    : await templates().delete().eq("id", "default");
  if (error && !isMissingTable(error)) throw error;
  return !error;
}
