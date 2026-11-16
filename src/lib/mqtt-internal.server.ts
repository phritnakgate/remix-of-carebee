import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { timeToMinutes, todaysDoses } from "./device-api";
import { confirmDeviceDose } from "./device-confirm.server";
import { receiveDeviceStatus } from "./device-status.server";

const deviceIdSchema = z.string().uuid();
const digest = (value: string) => createHash("sha256").update(value).digest();

export async function handleMqttInternalRequest(request: Request, url: URL) {
  const token = process.env["MQTT_BRIDGE_TOKEN"];
  const headers = { "Cache-Control": "no-store" };
  if (
    !token ||
    !timingSafeEqual(digest(`Bearer ${token}`), digest(request.headers.get("authorization") ?? ""))
  ) {
    return new Response(null, { status: 401, headers });
  }

  const id = deviceIdSchema.safeParse(url.searchParams.get("deviceId"));
  if (!id.success) return new Response(null, { status: 400, headers });
  if (request.method === "POST" && url.pathname === "/api/internal/mqtt/status") {
    return receiveDeviceStatus(request, id.data);
  }
  if (request.method === "POST" && url.pathname === "/api/internal/mqtt/confirm") {
    return confirmDeviceDose(request, id.data);
  }
  if (request.method !== "GET" || url.pathname !== "/api/internal/mqtt/due") {
    return new Response(null, { status: 404, headers });
  }

  const { data: device, error } = await supabaseAdmin
    .from("devices")
    .select("owner_id")
    .eq("id", id.data)
    .eq("mode", "real")
    .maybeSingle();
  if (error) throw error;
  if (!device) return new Response(null, { status: 404, headers });

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("timezone")
    .eq("id", device.owner_id)
    .maybeSingle();
  if (profileError) throw profileError;

  const timezone = profile?.timezone || "Asia/Bangkok";
  const at = new Date();
  const { now, doses } = await todaysDoses(supabaseAdmin, device.owner_id, timezone, at);
  const due = doses.filter(
    (dose) => dose.reminder && !dose.taken && timeToMinutes(dose.time) === now.minutes,
  );
  return Response.json({ date: now.date, timezone, at: at.toISOString(), doses: due }, { headers });
}
