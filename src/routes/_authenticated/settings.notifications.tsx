import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { table } from "@/lib/db";
import { formatTime } from "@/lib/chat-utils";
import { Page } from "@/components/Page";
import { DEFAULT_PREFS, usePreferences, useSavePrefs, type Prefs } from "@/hooks/use-preferences";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  head: () => ({ meta: [{ title: "Уведомления — VexChat" }] }),
  component: Notifications,
});

function Notifications() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const p = usePreferences().data ?? DEFAULT_PREFS;
  const save = useSavePrefs();
  const [perm, setPerm] = useState<string>("unsupported");
  useEffect(() => { if (typeof Notification !== "undefined") setPerm(Notification.permission); }, []);
  const set = (patch: Partial<Prefs>) => save(patch).catch((e) => toast.error(e.message));
  const list = useQuery({ queryKey: ["notifications"], queryFn: async () => (await table("notifications").select("*").order("created_at", { ascending: false }).limit(30)).data ?? [] });
  const rows: [keyof Prefs, string][] = [["notify_messages", "Сообщения"], ["notify_preview", "Показывать текст в уведомлениях"], ["notify_invites", "Приглашения"], ["notify_calls", "Звонки"], ["sounds_enabled", "Звуки"]];
  return (
    <Page title="Уведомления">
      <section className="glass space-y-4 rounded-3xl p-5">
        {rows.map(([k, label]) => <div key={k} className="flex items-center justify-between"><Label>{label}</Label><Switch checked={p[k] as boolean} onCheckedChange={(v) => set({ [k]: v })} /></div>)}
        <p className="text-xs text-muted-foreground">Настройки для отдельного чата — в его меню («Без звука»). Если уведомление отключено, оно не создаётся.</p>
      </section>
      <section className="glass mt-4 space-y-2 rounded-3xl p-5">
        <h2 className="font-semibold">Системные уведомления браузера</h2>
        <p className="text-sm text-muted-foreground">Разрешение: {{ granted: "выдано", denied: "запрещено в браузере", default: "не запрошено", unsupported: "не поддерживается" }[perm] ?? perm}. Фоновые push-уведомления при закрытом приложении пока не реализованы — для них нужен push-сервис.</p>
        {perm === "default" && <Button size="sm" onClick={async () => setPerm(await Notification.requestPermission())}>Разрешить</Button>}
      </section>
      <section className="mt-4"><div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Последние</h2>
        <Button size="sm" variant="ghost" onClick={async () => { await table("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null); qc.invalidateQueries({ queryKey: ["notifications"] }); }}>Прочитать все</Button></div>
        <ul className="space-y-2">{list.data?.map((n: { id: string; title: string; body: string | null; read_at: string | null; created_at: string }) => (
          <li key={n.id} className={`glass rounded-2xl p-3 text-sm ${n.read_at ? "opacity-60" : ""}`}><b>{n.title}</b><span className="float-right text-xs text-muted-foreground">{formatTime(n.created_at)}</span><p className="text-muted-foreground">{n.body}</p></li>))}
          {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Пока ничего нет</li>}</ul></section>
    </Page>
  );
}
