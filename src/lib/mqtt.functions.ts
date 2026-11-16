import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mqttCommandSchema } from "./mqtt";

export const manageMqttConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => mqttCommandSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: device } = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_id", context.userId)
      .eq("mode", "real")
      .maybeSingle();
    if (!device) return { error: "forbidden" } as const;

    const { requestMqttBridge } = await import("./mqtt-bridge.server");
    return requestMqttBridge(data);
  });
