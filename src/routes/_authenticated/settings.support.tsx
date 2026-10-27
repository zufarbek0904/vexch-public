import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { friendlyError, formatTime } from "@/lib/chat-utils";
import { Page } from "@/components/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/settings/support")({
  head: () => ({ meta: [{ title: "Поддержка — VexChat" }] }),
  component: Support,
});
const CATS = [["account", "Аккаунт"], ["bug", "Ошибка"], ["abuse", "Нарушение"], ["other", "Другое"]] as const;
const ST: Record<string, string> = { open: "открыто", pending: "ответ получен", resolved: "решено", closed: "закрыто" };

function Support() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [cat, setCat] = useState<string>("account");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const tickets = useQuery({ queryKey: ["tickets"], queryFn: async () => (await table("support_tickets").select("*").eq("user_id", user.id).order("updated_at", { ascending: false })).data ?? [] });
  const thread = useQuery({ queryKey: ["ticket", openId], enabled: !!openId, queryFn: async () => (await table("ticket_messages").select("*").eq("ticket_id", openId).order("created_at")).data ?? [] });

  async function create() {
    const { data, error } = await table("support_tickets").insert({ user_id: user.id, category: cat, subject: subject.trim(), body: body.trim() }).select().single();
    if (error) { toast.error(friendlyError(error.message)); return; }
    setSubject(""); setBody(""); setOpenId(data.id); qc.invalidateQueries({ queryKey: ["tickets"] }); toast.success("Обращение создано");
  }
  async function post() {
    try { await rpc("support_post_message", { _ticket: openId, _body: reply }); setReply(""); thread.refetch(); qc.invalidateQueries({ queryKey: ["tickets"] }); } catch (e) { toast.error((e as Error).message); }
  }
  const cur = tickets.data?.find((t: { id: string }) => t.id === openId);
  return (
    <Page title="Поддержка">
      {!openId ? (
        <>
          <section className="glass space-y-3 rounded-3xl p-5"><h2 className="font-semibold">Новое обращение</h2>
            <div className="flex flex-wrap gap-2">{CATS.map(([k, l]) => <Button key={k} size="sm" variant={cat === k ? "default" : "outline"} onClick={() => setCat(k)}>{l}</Button>)}</div>
            <Input placeholder="Тема" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea placeholder="Опишите проблему" maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} />
            <Button disabled={subject.trim().length < 3 || !body.trim()} onClick={create}>Отправить</Button></section>
          <ul className="mt-4 space-y-2">{tickets.data?.map((t: { id: string; subject: string; status: string; updated_at: string }) => (
            <li key={t.id}><button onClick={() => setOpenId(t.id)} className="glass flex w-full justify-between rounded-2xl p-3 text-left text-sm"><b className="truncate">{t.subject}</b><span className="text-xs text-muted-foreground">{ST[t.status]} · {formatTime(t.updated_at)}</span></button></li>))}</ul>
        </>
      ) : (
        <section className="space-y-3"><Button size="sm" variant="ghost" onClick={() => setOpenId(null)}>← Назад</Button>
          <div className="glass rounded-2xl p-3"><b>{cur?.subject}</b><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{cur?.body}</p><p className="mt-1 text-xs">Статус: {ST[cur?.status]}</p></div>
          {thread.data?.map((m: { id: string; is_staff: boolean; body: string; created_at: string }) => <div key={m.id} className={`rounded-2xl p-3 text-sm ${m.is_staff ? "glass" : "bg-muted"}`}><b className="text-xs">{m.is_staff ? "Поддержка" : "Вы"} · {formatTime(m.created_at)}</b><p className="whitespace-pre-wrap">{m.body}</p></div>)}
          {cur && (cur.status === "resolved" || cur.status === "closed") ? <Button onClick={async () => { try { await rpc("support_reopen", { _id: cur.id }); qc.invalidateQueries({ queryKey: ["tickets"] }); } catch (e) { toast.error((e as Error).message); } }}>Открыть заново</Button>
            : <div className="flex gap-2"><Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Сообщение" /><Button disabled={!reply.trim()} onClick={post}>Отправить</Button></div>}
        </section>
      )}
    </Page>
  );
}
