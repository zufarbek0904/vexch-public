import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { serverHealth } from "@/lib/server.functions";
import { Card, Need, dt } from "@/components/AdminKit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/health")({ component: () => <Need perm="health.view"><Health /></Need> });

function checkRealtime(): Promise<{ ok: boolean; ms: number; detail: string }> {
  return new Promise((resolve) => {
    const t = Date.now();
    const ch = supabase.channel(`health-${Math.random().toString(36).slice(2)}`);
    const timer = setTimeout(() => { supabase.removeChannel(ch); resolve({ ok: false, ms: Date.now() - t, detail: "нет ответа за 6 с" }); }, 6000);
    ch.subscribe((st) => {
      if (st === "SUBSCRIBED") { clearTimeout(timer); supabase.removeChannel(ch); resolve({ ok: true, ms: Date.now() - t, detail: "канал подключён" }); }
      if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") { clearTimeout(timer); supabase.removeChannel(ch); resolve({ ok: false, ms: Date.now() - t, detail: st }); }
    });
  });
}

function Health() {
  const fn = useServerFn(serverHealth);
  const [ran, setRan] = useState(false);
  const q = useQuery({
    queryKey: ["health"], enabled: ran, retry: false, staleTime: 0,
    queryFn: async () => { const [server, rt] = await Promise.all([fn(), checkRealtime()]); return { server, rt, at: new Date().toISOString() }; },
  });
  const rows = q.data ? [...q.data.server.checks, { name: "Realtime", ...q.data.rt }] : [];
  const cron = q.data?.server.cron as { cron_available?: boolean; cron_jobs?: { name: string; active: boolean; schedule: string }[] } | null;
  return (
    <div className="space-y-4">
      <Card><p className="mb-3 text-sm text-muted-foreground">Проверки выполняются по нажатию и показывают только реальный результат. Пока вы их не запустили, статус «не проверялось».</p>
        <Button onClick={() => (ran ? q.refetch() : setRan(true))} disabled={q.isFetching}>{q.isFetching ? "Проверяем…" : "Запустить проверку"}</Button></Card>
      {!ran && <p className="text-sm text-muted-foreground">Не проверялось</p>}
      {q.error && <p className="text-destructive">Проверка не выполнена: {(q.error as Error).message}</p>}
      {q.data && <>
        <Card title={`Проверено: ${dt(q.data.at)}`}><ul className="space-y-2 text-sm">{rows.map((r) => <li key={r.name} className="flex items-center gap-2">{r.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}<b>{r.name}</b><span className="text-muted-foreground">{r.detail} · {r.ms} мс</span></li>)}</ul></Card>
        <Card title="Фоновые задачи (pg_cron)">{cron?.cron_available ? <ul className="text-sm">{cron.cron_jobs?.map((j) => <li key={j.name}>{j.name} · {j.schedule} · {j.active ? "активна" : "выключена"}</li>)}{!cron.cron_jobs?.length && <li className="text-warning">pg_cron есть, но задачи VexChat не созданы</li>}</ul> : <p className="text-sm text-warning">pg_cron недоступен: исчезающие сообщения не удаляются физически, отложенные не создают уведомления.</p>}</Card>
        <Card title="Ошибки и интеграции"><p className="text-sm">Ошибок серверных функций за 24 часа: <b>{q.data.server.errors24h}</b></p>
          <p className="text-sm">TURN для звонков: {q.data.server.turnConfigured ? "настроен (работоспособность нужно проверять реальным звонком между сетями)" : <span className="text-warning">не настроен — звонки между разными сетями могут не работать</span>}</p></Card></>}
    </div>
  );
}
