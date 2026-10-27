import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { Card, Need, dt } from "@/components/AdminKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/admin/announcements")({ component: () => <Need perm="announcements.manage"><Ann /></Need> });
type A = { id: string; title: string; body: string; audience: string; severity: string; status: string; publish_at: string | null; created_at: string };

function Ann() {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: "", body: "", audience: "all", severity: "info" });
  const [when, setWhen] = useState("");
  const list = useQuery({ queryKey: ["admin-ann"], queryFn: async (): Promise<A[]> => (await table("announcements").select("*").order("created_at", { ascending: false }).limit(50)).data ?? [] });
  const go = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); qc.invalidateQueries({ queryKey: ["admin-ann"] }); qc.invalidateQueries({ queryKey: ["announcements"] }); } catch (e) { toast.error((e as Error).message); } };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Новое объявление"><div className="space-y-2">
        <Input placeholder="Заголовок" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Textarea placeholder="Текст" maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="flex flex-wrap gap-2">{[["all", "Всем"], ["staff", "Сотрудникам"]].map(([k, l]) => <Button key={k} size="sm" variant={f.audience === k ? "default" : "outline"} onClick={() => setF({ ...f, audience: k })}>{l}</Button>)}
          {[["info", "Инфо"], ["warning", "Важно"], ["maintenance", "Обслуживание"]].map(([k, l]) => <Button key={k} size="sm" variant={f.severity === k ? "default" : "outline"} onClick={() => setF({ ...f, severity: k })}>{l}</Button>)}</div>
        <div><p className="mb-1 text-xs text-muted-foreground">Опубликовать в (пусто — сразу). Показ по расписанию работает без фоновых задач: объявление появляется, когда наступило время.</p><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">Предпросмотр так, как увидят пользователи:</p>
        <div className="glass-strong flex items-start gap-2 rounded-xl px-3 py-2 text-xs"><Megaphone className="mt-0.5 size-4 text-primary" /><div><b>{f.title || "Заголовок"}</b> — {f.body || "Текст объявления"} <span className="text-muted-foreground">(объявление системы)</span></div></div>
        <Button disabled={f.title.trim().length < 3 || !f.body.trim()} onClick={() => go(async () => { const id = await rpc<string>("admin_save_announcement", { _id: null, _title: f.title, _body: f.body, _audience: f.audience, _severity: f.severity }); await rpc("admin_publish_announcement", { _id: id, _publish_at: when ? new Date(when).toISOString() : null }); setF({ title: "", body: "", audience: "all", severity: "info" }); setWhen(""); }, "Опубликовано")}>Опубликовать</Button>
        <Button variant="outline" disabled={f.title.trim().length < 3 || !f.body.trim()} onClick={() => go(async () => { await rpc("admin_save_announcement", { _id: null, _title: f.title, _body: f.body, _audience: f.audience, _severity: f.severity }); }, "Черновик сохранён")}>Сохранить черновик</Button>
      </div></Card>
      <Card title="История"><ul className="space-y-2">{list.data?.map((a) => (
        <li key={a.id} className="rounded-xl bg-muted p-2 text-sm"><b>{a.title}</b> <span className="text-xs text-muted-foreground">· {a.status} · {a.audience} · {dt(a.publish_at ?? a.created_at)}</span><p className="text-xs">{a.body}</p>
          <div className="mt-1 flex gap-2">{a.status === "draft" && <Button size="sm" variant="outline" onClick={() => go(() => rpc("admin_publish_announcement", { _id: a.id }), "Опубликовано")}>Опубликовать</Button>}
            {a.status === "published" && <Button size="sm" variant="destructive" onClick={() => go(() => rpc("admin_revoke_announcement", { _id: a.id }), "Отозвано")}>Отозвать</Button>}</div></li>))}
        {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Объявлений ещё не было</li>}</ul></Card>
    </div>
  );
}
