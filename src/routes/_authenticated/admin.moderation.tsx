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

export const Route = createFileRoute("/_authenticated/admin/moderation")({ component: () => <Need perm="reports.view"><Moderation /></Need> });

type R = { id: string; created_at: string; status: "open" | "in_review" | "resolved" | "rejected"; priority: number; category: string; details: string | null; assigned_username: string | null; reporter_username: string | null; target_user_id: string | null; target_username: string | null; target_conversation_id: string | null; target_message_id: string | null; resolution: string | null; related_open: number };
type Ctx = { id: string; sender_username: string | null; body: string | null; created_at: string; is_target: boolean };
const PRI = ["", "низкий", "обычный", "высокий", "срочный"];

function Moderation() {
  const qc = useQueryClient();
  const perms = useAdminPerms().data?.perms;
  const [tab, setTab] = useState<"reports" | "appeals">("reports");
  const [status, setStatus] = useState("open");
  const [sel, setSel] = useState<R | null>(null);
  const [ctx, setCtx] = useState<Ctx[] | null>(null);
  const [comment, setComment] = useState("");
  const [dlg, setDlg] = useState<null | "resolve" | "reject" | "remove" | "warn" | "suspend" | "ban">(null);
  const reports = useQuery({ queryKey: ["admin-reports", status], queryFn: () => rpc<R[]>("admin_list_reports", { _status: status, _limit: 100 }) });
  const comments = useQuery({ queryKey: ["report-comments", sel?.id], enabled: !!sel, queryFn: async () => (await table("report_comments").select("*").eq("report_id", sel!.id).order("created_at")).data ?? [] });
  const appeals = useQuery({ queryKey: ["admin-appeals"], enabled: tab === "appeals", queryFn: () => rpc<{ id: string; created_at: string; status: string; body: string; username: string; action: string; action_reason: string; decision: string | null }[]>("admin_list_appeals", { _status: "open" }) });
  const [appealDlg, setAppealDlg] = useState<{ id: string; accept: boolean } | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-reports"] }); qc.invalidateQueries({ queryKey: ["admin-appeals"] }); };
  const guard = async (fn: () => Promise<unknown>, ok = "Готово, записано в журнал") => { try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error((e as Error).message); throw e; } };
  async function loadCtx() { try { setCtx(await rpc<Ctx[]>("admin_report_context", { _report: sel!.id })); } catch (e) { toast.error((e as Error).message); } }

  async function confirm(reason: string) {
    if (!sel || !dlg) return;
    if (dlg === "resolve" || dlg === "reject") await guard(() => rpc("admin_update_report", { _id: sel.id, _status: dlg === "resolve" ? "resolved" : "rejected", _resolution: reason }));
    if (dlg === "remove") await guard(() => rpc("admin_remove_message", { _msg: sel.target_message_id, _reason: reason, _report: sel.id }));
    if (dlg === "warn" || dlg === "suspend" || dlg === "ban") await guard(() => rpc("admin_apply_sanction", { _user: sel.target_user_id, _action: dlg, _reason: reason, _until: dlg === "suspend" ? new Date(Date.now() + 7 * 86400_000).toISOString() : null, _report: sel.id }));
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2"><Button size="sm" variant={tab === "reports" ? "default" : "outline"} onClick={() => setTab("reports")}>Жалобы</Button>
        {perms?.has("appeals.decide") && <Button size="sm" variant={tab === "appeals" ? "default" : "outline"} onClick={() => setTab("appeals")}>Апелляции</Button>}</div>

      {tab === "reports" ? (
        <>
          <div className="flex flex-wrap gap-2">{[["open", "Открытые"], ["in_review", "В работе"], ["resolved", "Решённые"], ["rejected", "Отклонённые"], ["all", "Все"]].map(([k, l]) => <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => { setStatus(k); setSel(null); setCtx(null); }}>{l}</Button>)}</div>
          <div className="grid gap-4 md:grid-cols-2">
            <ul className="space-y-2">{reports.data?.map((r) => (
              <li key={r.id}><button onClick={() => { setSel(r); setCtx(null); }} className={`glass w-full rounded-2xl p-3 text-left text-sm ${sel?.id === r.id ? "ring-2 ring-primary" : ""}`}>
                <b>{r.category}</b> · приоритет {PRI[r.priority]} · {r.status}<p className="text-xs text-muted-foreground">{dt(r.created_at)} · от @{r.reporter_username ?? "?"} → {r.target_username ? `@${r.target_username}` : r.target_message_id ? "сообщение" : "группа/канал"}
                  {r.related_open > 0 && <span className="text-warning"> · повторных жалоб: {r.related_open}</span>}</p></button></li>))}
              {reports.data?.length === 0 && <li className="text-sm text-muted-foreground">Жалоб нет</li>}</ul>
            {sel && (
              <Card title="Жалоба"><div className="space-y-2 text-sm">
                <p>{sel.details || <i className="text-muted-foreground">Без описания</i>}</p>
                <p className="text-xs text-muted-foreground">Назначена: {sel.assigned_username ? `@${sel.assigned_username}` : "никому"}{sel.resolution && ` · Решение: ${sel.resolution}`}</p>
                <div className="flex flex-wrap gap-2">
                  {perms?.has("reports.resolve") && sel.status !== "resolved" && sel.status !== "rejected" && <>
                    <Button size="sm" variant="outline" onClick={() => guard(() => rpc("admin_update_report", { _id: sel.id, _status: "in_review", _assign_to_me: true }))}>Взять в работу</Button>
                    {[1, 2, 3, 4].map((p) => <Button key={p} size="sm" variant={sel.priority === p ? "default" : "ghost"} onClick={() => guard(() => rpc("admin_update_report", { _id: sel.id, _status: sel.status, _priority: p }), "Приоритет изменён")}>{PRI[p]}</Button>)}
                    <Button size="sm" onClick={() => setDlg("resolve")}>Решить</Button><Button size="sm" variant="outline" onClick={() => setDlg("reject")}>Отклонить</Button></>}
                  {sel.target_message_id && perms?.has("reports.content") && <Button size="sm" variant="outline" onClick={loadCtx}>Показать сообщение</Button>}
                  {sel.target_message_id && perms?.has("content.remove") && <Button size="sm" variant="destructive" onClick={() => setDlg("remove")}>Удалить сообщение</Button>}
                  {sel.target_user_id && perms?.has("users.suspend") && <><Button size="sm" variant="outline" onClick={() => setDlg("warn")}>Предупредить</Button><Button size="sm" variant="outline" onClick={() => setDlg("suspend")}>Ограничить на 7 дн.</Button></>}
                  {sel.target_user_id && perms?.has("users.ban") && <Button size="sm" variant="destructive" onClick={() => setDlg("ban")}>Заблокировать</Button>}</div>
                {ctx && <div className="space-y-1 rounded-xl bg-muted p-2"><p className="text-xs text-muted-foreground">Показан только фрагмент переписки в рамках этой жалобы (просмотр записан в аудит).</p>
                  {ctx.map((m) => <p key={m.id} className={`text-xs ${m.is_target ? "font-bold text-warning" : ""}`}>@{m.sender_username ?? "?"}: {m.body ?? "—"}</p>)}</div>}
                <h3 className="pt-1 font-semibold">Комментарии сотрудников</h3>
                {comments.data?.map((c: { id: string; body: string; created_at: string }) => <p key={c.id} className="text-xs">{dt(c.created_at)}: {c.body}</p>)}
                {perms?.has("reports.resolve") && <div className="flex gap-2"><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" /><Button size="sm" disabled={!comment.trim()} onClick={() => guard(async () => { await rpc("admin_add_report_comment", { _id: sel.id, _body: comment }); setComment(""); comments.refetch(); }, "Добавлено")}>Добавить</Button></div>}
              </div></Card>)}
          </div>
        </>
      ) : (
        <ul className="space-y-2">{appeals.data?.map((a) => (
          <li key={a.id} className="glass rounded-2xl p-3 text-sm"><b>@{a.username}</b> · {a.action} · {dt(a.created_at)}<p className="text-xs text-muted-foreground">Причина санкции: {a.action_reason}</p><p className="mt-1">{a.body}</p>
            <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => setAppealDlg({ id: a.id, accept: true })}>Принять (снять санкцию)</Button><Button size="sm" variant="outline" onClick={() => setAppealDlg({ id: a.id, accept: false })}>Отклонить</Button></div></li>))}
          {appeals.data?.length === 0 && <li className="text-sm text-muted-foreground">Открытых апелляций нет</li>}</ul>
      )}
      <ReasonDialog open={!!dlg} title={{ resolve: "Закрыть жалобу как решённую", reject: "Отклонить жалобу", remove: "Удалить сообщение", warn: "Предупреждение", suspend: "Ограничение на 7 дней", ban: "Блокировка аккаунта" }[dlg ?? "resolve"]}
        danger={dlg === "remove" || dlg === "ban"} needAck={dlg === "ban"} onClose={() => setDlg(null)} onConfirm={confirm} />
      <ReasonDialog open={!!appealDlg} title={appealDlg?.accept ? "Принять апелляцию" : "Отклонить апелляцию"} description="Решение будет показано пользователю." onClose={() => setAppealDlg(null)}
        onConfirm={(r) => guard(() => rpc("admin_decide_appeal", { _id: appealDlg!.id, _accept: appealDlg!.accept, _decision: r }))} />
    </div>
  );
}
