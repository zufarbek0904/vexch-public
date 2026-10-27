import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { Card, Need, dt } from "@/components/AdminKit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/admin/support")({ component: () => <Need perm="support.handle"><Support /></Need> });
type T = { id: string; created_at: string; updated_at: string; status: string; priority: number; category: string; subject: string; username: string | null; report_id: string | null };

function Support() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("open");
  const [sel, setSel] = useState<T | null>(null);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const list = useQuery({ queryKey: ["admin-tickets", status], queryFn: () => rpc<T[]>("admin_list_tickets", { _status: status }) });
  const thread = useQuery({ queryKey: ["admin-ticket", sel?.id], enabled: !!sel, queryFn: async () => ({ ticket: (await table("support_tickets").select("*").eq("id", sel!.id).single()).data, msgs: (await table("ticket_messages").select("*").eq("ticket_id", sel!.id).order("created_at")).data ?? [] }) });
  const go = async (fn: () => Promise<unknown>) => { try { await fn(); qc.invalidateQueries({ queryKey: ["admin-tickets"] }); thread.refetch(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{[["open", "Открытые"], ["pending", "Ждут пользователя"], ["resolved", "Решённые"], ["closed", "Закрытые"], ["all", "Все"]].map(([k, l]) => <Button key={k} size="sm" variant={status === k ? "default" : "outline"} onClick={() => { setStatus(k); setSel(null); }}>{l}</Button>)}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <ul className="space-y-2">{list.data?.map((t) => <li key={t.id}><button onClick={() => setSel(t)} className={`glass w-full rounded-2xl p-3 text-left text-sm ${sel?.id === t.id ? "ring-2 ring-primary" : ""}`}><b>{t.subject}</b><p className="text-xs text-muted-foreground">@{t.username ?? "?"} · {t.category} · приоритет {t.priority} · {t.status} · {dt(t.updated_at)}</p></button></li>)}
          {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Обращений нет</li>}</ul>
        {sel && thread.data?.ticket && (
          <Card title={sel.subject}><div className="space-y-2 text-sm">
            <p className="whitespace-pre-wrap">{thread.data.ticket.body}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => go(() => rpc("support_update_ticket", { _id: sel.id, _assign_to_me: true }))}>Взять</Button>
              {["resolved", "closed", "open"].map((s) => <Button key={s} size="sm" variant="outline" onClick={() => go(() => rpc("support_update_ticket", { _id: sel.id, _status: s }))}>{{ resolved: "Решено", closed: "Закрыть", open: "Открыть заново" }[s]}</Button>)}
              {[1, 2, 3, 4].map((p) => <Button key={p} size="sm" variant={thread.data.ticket.priority === p ? "default" : "ghost"} onClick={() => go(() => rpc("support_update_ticket", { _id: sel.id, _priority: p }))}>P{p}</Button>)}</div>
            {sel.report_id && <p className="text-xs text-muted-foreground">Связано с жалобой {sel.report_id.slice(0, 8)} (откройте в «Модерации», если у вас есть доступ).</p>}
            {thread.data.msgs.map((m: { id: string; is_staff: boolean; internal: boolean; body: string; created_at: string }) => <div key={m.id} className={`rounded-xl p-2 text-xs ${m.internal ? "bg-warning/15" : m.is_staff ? "glass" : "bg-muted"}`}><b>{m.internal ? "Внутренняя заметка" : m.is_staff ? "Поддержка" : "Пользователь"} · {dt(m.created_at)}</b><p className="whitespace-pre-wrap">{m.body}</p></div>)}
            <Textarea value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} placeholder="Ответ" />
            <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs"><Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} /> внутренняя заметка</label>
              <Button size="sm" disabled={!reply.trim()} onClick={() => go(async () => { await rpc("support_post_message", { _ticket: sel.id, _body: reply, _internal: internal }); setReply(""); })}>Отправить</Button></div>
          </div></Card>)}
      </div>
    </div>
  );
}
