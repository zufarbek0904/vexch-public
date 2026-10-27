import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/db";

/** Роли и права текущего пользователя. Только для показа/скрытия интерфейса — реальная проверка всегда в БД. */
export function useAdminPerms() {
  return useQuery({
    queryKey: ["admin-perms"], staleTime: 60_000,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const roles: string[] = ((await table("user_roles").select("role").eq("user_id", u.user!.id)).data ?? []).map((r: { role: string }) => r.role);
      const perms = roles.length ? ((await table("role_permissions").select("permission").in("role", roles)).data ?? []).map((r: { permission: string }) => r.permission) : [];
      return { roles, perms: new Set<string>(perms) };
    },
  });
}
