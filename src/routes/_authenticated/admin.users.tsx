import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { rpc } from "@/lib/db";
import { adminDeleteUser } from "@/lib/server.functions";
import { useAdminPerms } from "@/hooks/use-admin";
import { Card, Need, dt } from "@/components/AdminKit";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/users")({ component: () => <Need perm="users.view"><Users /></Need> });

type U = { id: string; username: string; display_name: string; created_at: string; email_confirmed: boolean; banned_at: string | null; suspended_until: string | null; roles: string[]; open_reports: number };
type Act = { user: U; kind: "warn" | "suspend" | "ban" | "unban" | "delete" };
const FILTERS = [["all", "Все"], ["banned", "Заблокированные"], ["suspended", "Ограниченные"], ["staff", "Сотрудники"], ["unconfirmed", "Без подтверждения email"]];

function Users() {
  const qc = useQueryClient();
  const perms = useAdminPerms().data?.perms;
  const del = useServerFn(adminDeleteUser);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [act, setAct] = useState<Act | null>(null);
  const [days, setDays] = useState(7);
  const list = useQuery({ queryKey: ["admin-users", q, status, from], queryFn: () => rpc<U[]>("admin_list_users", { _q: q || null, _status: status, _from: from ? new Date(from).toISOString() : null, _limit: 50, _offset: 0 }) });
  const detail = useQuery({ queryKey: ["admin-user", sel], enabled: !!sel, queryFn: () => rpc<{ profile: { username: string; display_name: string; bio: string; created_at: string }; email_confirmed: boolean; status: { banned_at: string | null; suspended_until: string | null; reason: string | null } | null; roles: string[]; sanctions: { id: string; action: string; reason: string; created_at: string; revoked_at: string | null; expires_at: string | null }[]; reports: { id: string; category: string; status: string; created_at: string }[]; deletion_request: { status: string; requested_at: string } | null }>("admin_user_detail", { _id: sel }) });

  async function run(reason: string) {
    if (!act) return;
    try {
      if (act.kind === "delete") await del({ data: { userId: act.user.id, reason } });
      else await rpc("admin_apply_sanction", { _user: act.user.id, _action: act.kind, _reason: reason, _until: act.kind === "suspend" ? new Date(Date.now() + days * 86400_000).toISOString() : null });
      toast.success("Выполнено, записано в журнал аудита");
      qc.invalidateQueries({ queryKey: ["admin-users"] }); qc.invalidateQueries({ queryKey: ["admin-user", act.user.id] });
    } catch (e) { toast.error((e as Error).message); throw e; }
  }
  const titles = { warn: "Предупреждение", suspend: "Временная блокировка", ban: "Заблокировать аккаунт", unban: "Снять блокировку", delete: "Удалить аккаунт навсегда" };

  return (
    <div className="space-y-4">
      <Card><div className="flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Поиск по username или ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Зарегистрирован после" />
        {FILTERS.map(([k, l]) => <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => setStatus(k)}>{l}</Button>)}</div></Card>
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">{list.data?.map((u) => (
          <li key={u.id}><button onClick={() => setSel(u.id)} className={`glass w-full rounded-2xl p-3 text-left text-sm ${sel === u.id ? "ring-2 ring-primary" : ""}`}>
            <b>@{u.username}</b> {u.display_name && <span className="text-muted-foreground">· {u.display_name}</span>}
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><span>с {dt(u.created_at)}</span>{!u.email_confirmed && <span className="text-warning">email не подтверждён</span>}
              {u.banned_at && <span className="text-destructive">заблокирован</span>}{u.suspended_until && new Date(u.suspended_until) > new Date() && <span className="text-destructive">ограничен до {dt(u.suspended_until)}</span>}
              {u.roles.length > 0 && <span className="text-primary">{u.roles.join(", ")}</span>}{u.open_reports > 0 && <span>жалоб: {u.open_reports}</span>}</div></button></li>))}
          {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Никого не найдено</li>}</ul>
        {sel && detail.data && (
          <Card title={`@${detail.data.profile.username}`}>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">{detail.data.profile.bio || "Без описания"}</p>
              <p>Email: {detail.data.email_confirmed ? "подтверждён" : "не подтверждён"} (адрес скрыт) · с {dt(detail.data.profile.created_at)}</p>
              {detail.data.deletion_request?.status === "pending" && <p className="text-warning">Запрос на удаление аккаунта от {dt(detail.data.deletion_request.requested_at)}</p>}
              {detail.data.status?.banned_at && <p className="text-destructive">Заблокирован: {detail.data.status.reason}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                {perms?.has("users.suspend") && <><Button size="sm" variant="outline" onClick={() => setAct({ user: list.data!.find((x) => x.id === sel)!, kind: "warn" })}>Предупредить</Button>
                  <Button size="sm" variant="outline" onClick={() => setAct({ user: list.data!.find((x) => x.id === sel)!, kind: "suspend" })}>Ограничить</Button>
                  <Input type="number" min={1} max={365} className="h-8 w-16" value={days} onChange={(e) => setDays(Math.min(365, Math.max(1, Number(e.target.value) || 1)))} aria-label="Дней" /><span className="text-xs">дн.</span></>}
                {perms?.has("users.ban") && <><Button size="sm" variant="destructive" onClick={() => setAct({ user: list.data!.find((x) => x.id === sel)!, kind: "ban" })}>Заблокировать</Button>
                  <Button size="sm" variant="outline" onClick={() => setAct({ user: list.data!.find((x) => x.id === sel)!, kind: "unban" })}>Разблокировать</Button></>}
                {perms?.has("users.delete") && <Button size="sm" variant="destructive" onClick={() => setAct({ user: list.data!.find((x) => x.id === sel)!, kind: "delete" })}>Удалить аккаунт</Button>}</div>
              <h3 className="pt-2 font-semibold">История санкций</h3>
              {detail.data.sanctions.length === 0 && <p className="text-muted-foreground">Нет</p>}
              {detail.data.sanctions.map((s) => <p key={s.id} className="text-xs"><b>{s.action}</b> · {dt(s.created_at)}{s.revoked_at && " · снята"} — {s.reason}</p>)}
              <h3 className="pt-2 font-semibold">Жалобы на пользователя</h3>
              {detail.data.reports.length === 0 && <p className="text-muted-foreground">Нет</p>}
              {detail.data.reports.map((r) => <p key={r.id} className="text-xs">{r.category} · {r.status} · {dt(r.created_at)}</p>)}
            </div>
          </Card>)}
      </div>
      <ReasonDialog open={!!act} title={act ? `${titles[act.kind]}: @${act.user.username}` : ""} danger={act?.kind === "ban" || act?.kind === "delete"} needAck={act?.kind === "delete" || act?.kind === "ban"}
        description={act?.kind === "delete" ? "Профиль и данные аккаунта будут удалены безвозвратно." : act?.kind === "suspend" ? `Пользователь не сможет писать и звонить ${days} дн.` : undefined}
        confirmLabel={act ? titles[act.kind] : ""} onClose={() => setAct(null)} onConfirm={run} />
    </div>
  );
}
