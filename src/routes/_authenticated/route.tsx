import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AccountGate } from "@/components/AccountGate";
import { CallProvider } from "@/components/CallProvider";
import { useApplyPreferences } from "@/hooks/use-preferences";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  useApplyPreferences();
  return (
    <AccountGate userId={user.id}>
      <CallProvider userId={user.id}>
        <Outlet />
      </CallProvider>
    </AccountGate>
  );
}
