import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table } from "@/lib/db";
import { useAdminPerms } from "@/hooks/use-admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Админ-панель — VexChat" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    const roles = (await table("user_roles").select("role").eq("user_id", data.user!.id)).data ?? [];
    if (!roles.length) throw redirect({ to: "/chats" });
  },
  component: AdminLayout,
});

const SECTIONS = [
  { to: "/admin", label: "Обзор", perm: "analytics.view", exact: true },
  { to: "/admin/users", label: "Пользователи", perm: "users.view" },
  { to: "/admin/moderation", label: "Модерация", perm: "reports.view" },
  { to: "/admin/groups", label: "Группы и каналы", perm: "groups.moderate" },
  { to: "/admin/support", label: "Поддержка", perm: "support.handle" },
  { to: "/admin/announcements", label: "Объявления", perm: "announcements.manage" },
  { to: "/admin/roles", label: "Роли", perm: "users.view" },
  { to: "/admin/settings", label: "Настройки", perm: "settings.view" },
  { to: "/admin/audit", label: "Аудит", perm: "audit.view" },
  { to: "/admin/health", label: "Здоровье", perm: "health.view" },
  { to: "/admin/backups", label: "Резервные копии", perm: "backups.view" },
] as const;

function AdminLayout() {
  const { data } = useAdminPerms();
  useEffect(() => { rpc("log_staff_login").catch(() => {}); }, []);
  const items = SECTIONS.filter((s) => data?.perms.has(s.perm));
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-10">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Админ-панель</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>{data?.roles.join(", ")}</span><Link to="/chats" className="text-primary underline">В приложение</Link></div>
      </header>
      <nav aria-label="Разделы админ-панели" className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {items.map((s) => (
          <Link key={s.to} to={s.to} activeOptions={{ exact: "exact" in s }} className={cn("glass shrink-0 rounded-full px-4 py-1.5 text-sm")} activeProps={{ className: "bg-gradient-primary !text-primary-foreground" }}>{s.label}</Link>))}
      </nav>
      <Outlet />
    </main>
  );
}
