import { getRequest, setResponseHeader, setResponseStatus } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AdminTable } from "./admin.functions";

const pageSize = 20;

export async function adminAccessStatus() {
  setResponseHeader("cache-control", "no-store");
  const token = getRequest().headers.get("X-CareBee-Admin-Token");
  if (!token || token.length > 8192) return "invalid_session";

  try {
    const { data, error } = await supabaseAdmin.auth.getClaims(token);
    if (error && (error.status ?? 0) >= 500) return "unavailable";
    const claims = data?.claims;
    if (error || !claims?.sub) return "invalid_session";
    if (
      !Array.isArray(claims.amr) ||
      !claims.amr.some((entry) =>
        typeof entry === "string" ? entry === "password" : entry?.method === "password",
      )
    )
      return "password_required";

    const allowedIds = (process.env["CAREBEE_ADMIN_USER_IDS"] ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase());
    if (allowedIds.includes(claims.sub.toLowerCase())) return "allowed";

    // Check the current account so revoking app_metadata takes effect on the next request.
    const account = await supabaseAdmin.auth.getUser(token);
    if (account.error && (account.error.status ?? 0) >= 500) return "unavailable";
    if (account.error || account.data.user?.id !== claims.sub) return "invalid_session";
    return account.data.user.app_metadata["carebee_admin"] === true ? "allowed" : "forbidden";
  } catch {
    return "unavailable";
  }
}

export async function requireAdmin() {
  if ((await adminAccessStatus()) !== "allowed") throw new Error("Admin access required");
}

export async function checkAdminHttpAccess() {
  const result = await adminAccessStatus();
  if (result === "invalid_session") setResponseStatus(401);
  if (result === "password_required" || result === "forbidden") setResponseStatus(403);
  if (result === "unavailable") setResponseStatus(503);
  return result;
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
