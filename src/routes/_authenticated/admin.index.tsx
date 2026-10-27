import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { rpc } from "@/lib/db";
import { buildCsv, formatBytes } from "@/lib/chat-utils";
import { Card, Need, Stat } from "@/components/AdminKit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/")({ component: () => <Need perm="analytics.view"><Dashboard /></Need> });

type Series = { day: string; count: number }[];
type Stats = { total_users: number; new_users: number; active_day: number; active_week: number; active_month: number; messages: number; groups: number; channels: number; calls_by_status: Record<string, number>; open_reports: number; banned: number; suspended: number; open_tickets: number; storage_bytes: number; attachments: number; errors: number; spam_events: number; registrations_by_day: Series; messages_by_day: Series; reports_by_day: Series };

function Chart({ title, data }: { title: string; data: Series }) {
  return (
    <Card title={title}>
      {data.length < 2 ? <p className="py-8 text-center text-sm text-muted-foreground">Недостаточно данных</p> : (
        <div className="h-44"><ResponsiveContainer><LineChart data={data}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="day" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} width={30} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12 }} /><Line dataKey="count" stroke="var(--chart-1)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>)}
    </Card>
  );
}

function Dashboard() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["admin-stats", days], queryFn: () => rpc<Stats>("admin_dashboard_stats", { _from: new Date(Date.now() - days * 86400_000).toISOString(), _to: new Date().toISOString() }) });
  const s = q.data;
  async function exportCsv() {
    if (!s) return;
    try {
      await rpc("log_export", { _kind: `dashboard_${days}d` });
      const rows = [...new Set([...s.registrations_by_day, ...s.messages_by_day, ...s.reports_by_day].map((r) => r.day))].sort().map((day) => ({
        day, registrations: s.registrations_by_day.find((r) => r.day === day)?.count ?? 0, messages: s.messages_by_day.find((r) => r.day === day)?.count ?? 0, reports: s.reports_by_day.find((r) => r.day === day)?.count ?? 0 }));
      if (!rows.length) { toast.info("Нет данных для экспорта"); return; }
      const url = URL.createObjectURL(new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" }));
      Object.assign(document.createElement("a"), { href: url, download: `vexchat-stats-${days}d.csv` }).click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">{[7, 30, 90].map((d) => <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>{d} дней</Button>)}
        <Button size="sm" variant="outline" className="ml-auto" onClick={exportCsv} disabled={!s}>Экспорт CSV (агрегаты)</Button></div>
      {q.isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {q.error && <p className="text-destructive">{(q.error as Error).message}</p>}
      {s && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Аккаунтов" value={s.total_users} /><Stat label={`Новых за ${days} дн.`} value={s.new_users} />
          <Stat label="Писали за сутки" value={s.active_day} hint="отправили сообщение" /><Stat label="За неделю / месяц" value={`${s.active_week} / ${s.active_month}`} hint="отправили сообщение" />
          <Stat label={`Сообщений за ${days} дн.`} value={s.messages} /><Stat label="Групп / каналов" value={`${s.groups} / ${s.channels}`} />
          <Stat label="Открытые жалобы" value={s.open_reports} /><Stat label="Заблокировано / ограничено" value={`${s.banned} / ${s.suspended}`} />
          <Stat label="Обращения в поддержку" value={s.open_tickets} /><Stat label="Хранилище" value={formatBytes(s.storage_bytes)} hint={`файлов: ${s.attachments}`} />
          <Stat label="Ошибки серверных функций" value={s.errors} /><Stat label="Срабатываний антиспама" value={s.spam_events} />
        </div>
        <Card title="Звонки по статусам">{Object.keys(s.calls_by_status).length ? <div className="flex flex-wrap gap-4 text-sm">{Object.entries(s.calls_by_status).map(([k, v]) => <span key={k}>{k}: <b>{v}</b></span>)}</div> : <p className="text-sm text-muted-foreground">Звонков за период не было</p>}</Card>
        <div className="grid gap-3 md:grid-cols-2"><Chart title="Регистрации по дням" data={s.registrations_by_day} /><Chart title="Сообщения по дням" data={s.messages_by_day} /><Chart title="Жалобы по дням" data={s.reports_by_day} /></div>
        <p className="text-xs text-muted-foreground">Доставка уведомлений не измеряется: у системы нет достоверных данных о доставке. Все числа — агрегаты из базы; персональные данные в отчёты не попадают.</p>
      </>}
    </div>
  );
}
