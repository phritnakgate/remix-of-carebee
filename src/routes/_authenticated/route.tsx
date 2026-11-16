import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ActiveBoxProvider } from "@/lib/active-box";
import { MqttSessionProvider } from "@/lib/mqtt-session";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext();
  return (
    <ActiveBoxProvider userId={user.id}>
      <MqttSessionProvider key={user.id} userId={user.id}>
        <AppShell>
          <Outlet />
        </AppShell>
      </MqttSessionProvider>
    </ActiveBoxProvider>
  );
}
