import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, ChevronRight, LayoutGrid, LifeBuoy, Palette, Shield, ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Page } from "@/components/Page";
import { table } from "@/lib/db";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({ meta: [{ title: "Настройки — VexChat" }, { name: "description", content: "Настройки VexChat: навигация, оформление, приватность." }] }),
  component: SettingsPage,
});

const items = [
  { to: "/settings/navigation", icon: LayoutGrid, label: "Нижняя панель" },
  { to: "/settings/appearance", icon: Palette, label: "Оформление" },
  { to: "/settings/notifications", icon: Bell, label: "Уведомления" },
  { to: "/settings/privacy", icon: Shield, label: "Приватность и безопасность" },
  { to: "/settings/support", icon: LifeBuoy, label: "Поддержка" },
] as const;

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const staff = useQuery({ queryKey: ["is-staff"], queryFn: async () => ((await table("user_roles").select("role").eq("user_id", user.id)).data?.length ?? 0) > 0 });
  return (
    <Page title="Настройки">
      <div className="glass divide-y divide-border overflow-hidden rounded-3xl">
        {items.map(({ to, icon: Icon, label }) => (
          <Link key={to} to={to} className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-accent">
            <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-primary"><Icon className="size-5 text-primary-foreground" /></span>
            <span className="flex-1 font-medium">{label}</span><ChevronRight className="size-5 text-muted-foreground" />
          </Link>))}
        {staff.data && (
          <Link to="/admin" className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-accent">
            <span className="flex size-9 items-center justify-center rounded-xl bg-secondary"><ShieldCheck className="size-5" /></span>
            <span className="flex-1 font-medium">Админ-панель</span><ChevronRight className="size-5 text-muted-foreground" /></Link>)}
      </div>
    </Page>
  );
}
