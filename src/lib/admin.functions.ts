import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { mqttPayloadLimit } from "./mqtt";
import { parseSensorTemplate } from "./load-cell";
import { profileSchema } from "./profile";
import { reminderPreview, renderReminderTemplate } from "./reminder-template";

const table = z.enum(["profiles", "devices", "medicines", "medication_schedules"]);
export type AdminTable = z.infer<typeof table>;

const recordId = z.object({ id: z.string().uuid() });
const name = z.string().trim().min(1).max(60);
const update = z.discriminatedUnion("table", [
  recordId.extend({ table: z.literal("profiles"), values: profileSchema }),
  recordId.extend({ table: z.literal("devices"), values: z.object({ name }) }),
  recordId.extend({
    table: z.literal("medicines"),
    values: z.object({
      name,
      quantity: z.number().int().min(0).max(2147483647),
      active: z.boolean(),
    }),
  }),
  recordId.extend({
    table: z.literal("medication_schedules"),
    values: z.object({
      dose_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      notify: z.boolean(),
    }),
  }),
]);

export const checkAdminAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { hasAdminAccess } = await import("./admin.server");
  return hasAdminAccess();
});

export const listAdminRecords = createServerFn({ method: "POST" })
  .validator(
    z.object({
      table,
      after: z.string().uuid().optional(),
      filter: z.string().uuid().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { requireAdmin, listRecords } = await import("./admin.server");
    await requireAdmin();
    return listRecords(data.table, data.after, data.filter);
  });

export const updateAdminRecord = createServerFn({ method: "POST" })
  .validator(update)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    switch (data.table) {
      case "profiles":
        return updateRow(
          supabaseAdmin
            .from("profiles")
            .update(data.values)
            .eq("id", data.id)
            .select("id")
            .single(),
        );
      case "devices":
        return updateRow(
          supabaseAdmin.from("devices").update(data.values).eq("id", data.id).select("id").single(),
        );
      case "medicines":
        return updateRow(
          supabaseAdmin
            .from("medicines")
            .update(data.values)
            .eq("id", data.id)
            .select("id")
            .single(),
        );
      case "medication_schedules":
        return updateRow(
          supabaseAdmin
            .from("medication_schedules")
            .update(data.values)
            .eq("id", data.id)
            .is("ends_on", null)
            .select("id")
            .single(),
        );
    }
  });

async function updateRow(request: PromiseLike<{ error: unknown }>) {
  const { error } = await request;
  if (error) throw new Error("Could not update record");
  return true;
}

const templateKind = z.object({ kind: z.enum(["reminder", "sensor"]) });

export const getAdminTemplate = createServerFn({ method: "POST" })
  .validator(templateKind)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    const { readSharedTemplate } = await import("./reminder-template.server");
    return readSharedTemplate(data.kind);
  });

export const saveAdminTemplate = createServerFn({ method: "POST" })
  .validator(templateKind.extend({ template: z.string().trim().max(mqttPayloadLimit) }))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin.server");
    await requireAdmin();
    if (data.template) {
      if (data.kind === "sensor") parseSensorTemplate(data.template);
      else renderReminderTemplate(data.template, reminderPreview);
    }
    const { writeSharedTemplate } = await import("./reminder-template.server");
    return writeSharedTemplate(data.kind, data.template);
  });
