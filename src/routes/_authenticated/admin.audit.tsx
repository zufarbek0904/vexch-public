import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { table } from "@/lib/db";
import { Card, Need, dt } from "@/components/AdminKit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/audit")({ component: () => <Need perm="audit.view"><Audit /></Need> });
type L = { id: number; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; reason: string | null; result: string; metadata: unknown; created_at: string };

function Audit() {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"audit" | "spam">("audit");
  const logs = useQuery({ queryKey: ["audit", q], queryFn: async () => {
    let r = table("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(100);
    if (q.trim()) r = r.ilike("action", `%${q.trim().replace(/[%_\\]/g, "")}%`);
    const rows: L[] = (await r).data ?? [];
    const ids = [...new Set(rows.map((x) => x.actor_id).filter(Boolean))] as string[];
    const names = ids.length ? ((await table("profiles").select("id, username").in("id", ids)).data ?? []) as { id: string; username: string }[] : [];
    return { rows, names: new Map(names.map((n) => [n.id, n.username])) };
  } });
  const spam = useQuery({ queryKey: ["spam"], enabled: tab === "spam", queryFn: async () => (await table("spam_events").select("*").order("created_at", { ascending: false }).limit(100)).data ?? [] });
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><Button size="sm" variant={tab === "audit" ? "default" : "outline"} onClick={() => setTab("audit")}>Действия сотрудников</Button><Button size="sm" variant={tab === "spam" ? "default" : "outline"} onClick={() => setTab("spam")}>Срабатывания антиспама</Button></div>
      {tab === "audit" ? <>
        <Input className="max-w-xs" placeholder="Фильтр по действию (role, sanction, setting…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <Card><ul className="divide-y divide-border text-xs">{logs.data?.rows.map((l) => (
          <li key={l.id} className="py-2"><b>{l.action}</b> · {l.result} · @{l.actor_id ? logs.data!.names.get(l.actor_id) ?? l.actor_id.slice(0, 8) : "система"} · {dt(l.created_at)}
            <p className="text-muted-foreground">{l.target_type}: {l.target_id?.slice(0, 36)} {l.reason && `— ${l.reason}`}</p>{l.metadata && JSON.stringify(l.metadata) !== "{}" && <p className="break-all text-[10px] text-muted-foreground">{JSON.stringify(l.metadata)}</p>}</li>))}
          {logs.data?.rows.length === 0 && <li className="py-4 text-muted-foreground">Записей нет</li>}</ul></Card>
        <p className="text-xs text-muted-foreground">Журнал только для чтения: изменение и удаление записей запрещено на уровне базы данных. Пароли, токены и тексты личных сообщений в него не попадают.</p></> :
        <Card><ul className="divide-y divide-border text-xs">{spam.data?.map((e: { id: number; kind: string; user_id: string | null; details: unknown; created_at: string }) => <li key={e.id} className="py-2"><b>{e.kind}</b> · {dt(e.created_at)} · {e.user_id?.slice(0, 8)} · {JSON.stringify(e.details)}</li>)}
          {spam.data?.length === 0 && <li className="py-4 text-muted-foreground">Срабатываний не было</li>}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Логируется превышение лимита сообщений. Автоматических блокировок по одному сигналу система не применяет — решение принимает сотрудник.</p></Card>}
    </div>
  );
}
