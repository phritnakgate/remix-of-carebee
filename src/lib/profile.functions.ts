import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { profileSchema } from "./profile";

export const saveOwnProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(profileSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // The authenticated subject is the only row this function can create or update.
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: context.userId, ...data }, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return profile;
  });
