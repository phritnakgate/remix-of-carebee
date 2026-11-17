import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AdminTable } from "./admin.functions";

const pageSize = 20;

export async function hasAdminAccess() {
  setResponseHeader("cache-control", "no-store");
  const token = getRequest().headers.get("X-CareBee-Admin-Token");
  const allowedIds = (process.env["CAREBEE_ADMIN_USER_IDS"] ?? "")
    .split(",")
    .map((id) => id.trim());
  if (!token || token.length > 8192 || !allowedIds.some(Boolean)) return false;

  const { data, error } = await supabaseAdmin.auth.getClaims(token);
  const claims = data?.claims;
  return Boolean(
    !error &&
    claims?.sub &&
    allowedIds.includes(claims.sub) &&
    claims.amr?.some((entry) =>
      typeof entry === "string" ? entry === "password" : entry.method === "password",
    ),
  );
}

export async function requireAdmin() {
  if (!(await hasAdminAccess())) throw new Error("Admin access required");
}

const records = {
  profiles: () => supabaseAdmin.from("profiles").select("id,display_name,phone,timezone"),
  devices: () => supabaseAdmin.from("devices").select("id,owner_id,name,mode,last_seen_at"),
  medicines: () =>
    supabaseAdmin.from("medicines").select("id,owner_id,name,quantity,active,device_id"),
  medication_schedules: () =>
    supabaseAdmin
      .from("medication_schedules")
      .select("id,owner_id,medicine_id,dose_time,notify,box_slot")
      .is("ends_on", null),
};

export async function listRecords(table: AdminTable, after?: string, filter?: string) {
  const query = records[table]()
    .order("id")
    .limit(pageSize + 1);
  if (after) query.gt("id", after);
  if (filter) {
    // UUIDs have already been checked by the input validator.
    if (table === "profiles") query.eq("id", filter);
    else if (table === "medication_schedules") {
      query.or(`id.eq.${filter},owner_id.eq.${filter},medicine_id.eq.${filter}`);
    } else query.or(`id.eq.${filter},owner_id.eq.${filter}`);
  }
  const { data, error } = await query;
  if (error) throw new Error("Could not load records");
  const rows = data.slice(0, pageSize);
  return {
    rows,
    next: data.length > pageSize ? (rows.at(-1)?.id ?? null) : null,
  };
}
