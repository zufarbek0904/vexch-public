import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { useAdminPerms } from "@/hooks/use-admin";
import { Card, Need, dt } from "@/components/AdminKit";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/roles")({ component: () => <Need perm="users.view"><Roles /></Need> });
const ROLES = ["owner", "super_admin", "admin", "moderator", "support", "analyst"] as const;
const LABEL: Record<string, string> = { owner: "Owner", super_admin: "Super Admin", admin: "Admin", moderator: "Moderator", support: "Support", analyst: "Analyst" };
const PERM_LABEL: Record<string, string> = { "users.view": "Просмотр пользователей", "users.suspend": "Предупреждения и ограничения", "users.ban": "Блокировка аккаунтов", "users.roles": "Выдача ролей", "users.delete": "Удаление аккаунтов", "reports.view": "Просмотр жалоб", "reports.content": "Фрагмент переписки по жалобе", "reports.resolve": "Решение жалоб", "appeals.decide": "Апелляции", "content.remove": "Удаление сообщений по жалобе", "groups.moderate": "Модерация групп и каналов", "analytics.view": "Аналитика", "export.run": "Экспорт агрегатов", "settings.view": "Просмотр настроек", "settings.edit": "Изменение настроек", "settings.dangerous": "Опасные настройки", "audit.view": "Журнал аудита", "support.handle": "Поддержка", "announcements.manage": "Объявления", "backups.view": "Просмотр бэкапов", "backups.manage": "Отметки о бэкапах", "health.view": "Здоровье системы" };

function Roles() {
  const qc = useQueryClient();
  const me = useAdminPerms().data;
  const [uq, setUq] = useState("");
  const [found, setFound] = useState<{ id: string; username: string }[]>([]);
  const [dlg, setDlg] = useState<{ user: string; name: string; role: string; grant: boolean } | null>(null);
  const staff = useQuery({ queryKey: ["admin-staff"], queryFn: () => rpc<{ user_id: string; username: string; role: string; granted_by_username: string | null; created_at: string }[]>("admin_list_staff") });
  const matrix = useQuery({ queryKey: ["perm-matrix"], queryFn: async () => (await table("role_permissions").select("*")).data ?? [] as { role: string; permission: string }[] });
  const log = useQuery({ queryKey: ["role-log"], enabled: !!me?.perms.has("audit.view"), queryFn: async () => (await table("admin_audit_logs").select("id, action, target_id, reason, metadata, created_at").like("action", "role.%").order("created_at", { ascending: false }).limit(20)).data ?? [] });
  const perms = [...new Set((matrix.data ?? []).map((r: { permission: string }) => r.permission))] as string[];
  const canGrant = me?.perms.has("users.roles");
  async function find(v: string) { setUq(v); if (v.trim().length < 2) { setFound([]); return; } try { setFound(await rpc("search_users", { _q: v })); } catch { setFound([]); } }
  return (
    <div className="space-y-4">
      <Card title="Сотрудники"><ul className="space-y-1 text-sm">{staff.data?.map((s) => (
        <li key={s.user_id + s.role} className="flex items-center gap-2"><b>@{s.username}</b><span className="text-primary">{LABEL[s.role]}</span><span className="text-xs text-muted-foreground">выдал @{s.granted_by_username ?? "система"} · {dt(s.created_at)}</span>
          {canGrant && s.role !== "owner" && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setDlg({ user: s.user_id, name: s.username, role: s.role, grant: false })}>Отозвать</Button>}</li>))}</ul></Card>
      {canGrant && <Card title="Назначить роль"><Input placeholder="Найти пользователя по @username" value={uq} onChange={(e) => find(e.target.value)} />
        <ul className="mt-2 space-y-2">{found.map((u) => <li key={u.id} className="flex flex-wrap items-center gap-2 text-sm"><b>@{u.username}</b>{ROLES.filter((r) => r !== "owner").map((r) => <Button key={r} size="sm" variant="outline" onClick={() => setDlg({ user: u.id, name: u.username, role: r, grant: true })}>{LABEL[r]}</Button>)}</li>)}</ul>
        <p className="mt-2 text-xs text-muted-foreground">Вы можете назначать только роли ниже своей. Роль Owner через приложение не выдаётся. Собственные роли менять нельзя. Проверки выполняет база данных.</p></Card>}
      <Card title="Матрица полномочий"><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th className="p-1 text-left">Право</th>{ROLES.map((r) => <th key={r} className="p-1">{LABEL[r]}</th>)}</tr></thead>
        <tbody>{perms.sort().map((p) => <tr key={p} className="border-t border-border"><td className="p-1">{PERM_LABEL[p] ?? p}</td>{ROLES.map((r) => <td key={r} className="p-1 text-center">{(matrix.data ?? []).some((m: { role: string; permission: string }) => m.role === r && m.permission === p) ? "✓" : ""}</td>)}</tr>)}</tbody></table></div></Card>
      {me?.perms.has("audit.view") && <Card title="Журнал изменения ролей"><ul className="space-y-1 text-xs">{log.data?.map((l: { id: number; action: string; metadata: { role?: string }; reason: string | null; created_at: string }) => <li key={l.id}>{dt(l.created_at)} · {l.action} · {l.metadata?.role} — {l.reason}</li>)}{log.data?.length === 0 && <li className="text-muted-foreground">Изменений ещё не было</li>}</ul></Card>}
      <ReasonDialog open={!!dlg} danger={!dlg?.grant} title={dlg ? `${dlg.grant ? "Назначить" : "Отозвать"} ${LABEL[dlg.role]}: @${dlg.name}` : ""} onClose={() => setDlg(null)}
        onConfirm={async (r) => { try { await rpc("admin_set_role", { _user: dlg!.user, _role: dlg!.role, _grant: dlg!.grant, _reason: r }); toast.success("Роль изменена, записано в журнал"); qc.invalidateQueries({ queryKey: ["admin-staff"] }); qc.invalidateQueries({ queryKey: ["role-log"] }); } catch (e) { toast.error((e as Error).message); throw e; } }} />
    </div>
  );
}
