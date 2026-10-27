import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table } from "@/lib/db";
import { Page } from "@/components/Page";
import { UserAvatar } from "@/components/UserAvatar";
import { DEFAULT_PREFS, usePreferences, useSavePrefs, type Prefs } from "@/hooks/use-preferences";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/privacy")({
  head: () => ({ meta: [{ title: "Приватность — VexChat" }] }),
  component: Privacy,
});

function sessionId(token: string | undefined) {
  try { return token ? JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id : null; } catch { return null; }
}

function Privacy() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const nav = useNavigate();
  const p = usePreferences().data ?? DEFAULT_PREFS;
  const save = useSavePrefs();
  const set = (patch: Partial<Prefs>) => save(patch).catch((e) => toast.error(e.message));
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: async () => {
    const b: { blocked_id: string }[] = (await table("blocks").select("blocked_id").eq("blocker_id", user.id)).data ?? [];
    const ids = b.map((x) => x.blocked_id);
    return ids.length ? ((await table("profiles").select("id, username, display_name, avatar_url").in("id", ids)).data ?? []) as { id: string; username: string; display_name: string; avatar_url: string | null }[] : [];
  } });
  const sessions = useQuery({ queryKey: ["sessions"], retry: false, queryFn: async () => ({ list: await rpc<{ id: string; created_at: string; refreshed_at: string | null; user_agent: string | null }[]>("my_sessions"), current: sessionId((await supabase.auth.getSession()).data.session?.access_token) }) });

  async function exportData() {
    try {
      const data = await rpc("export_my_data");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "vexchat-my-data.json" }); a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Page title="Приватность и безопасность">
      <section className="glass space-y-4 rounded-3xl p-5">
        <div className="space-y-2"><Label>Кто может писать вам первым</Label><div className="flex gap-2">
          {(["everyone", "contacts"] as const).map((v) => <Button key={v} size="sm" variant={p.who_can_message === v ? "default" : "outline"} onClick={() => set({ who_can_message: v })}>{v === "everyone" ? "Все" : "Только контакты"}</Button>)}</div></div>
        <div className="flex items-center justify-between"><div><Label>Отметки «прочитано»</Label><p className="text-xs text-muted-foreground">Если выключить, собеседники не увидят, что вы прочитали сообщение.</p></div><Switch checked={p.read_receipts} onCheckedChange={(v) => set({ read_receipts: v })} /></div>
        <p className="text-xs text-muted-foreground">Статус «в сети» и «был(а) недавно» VexChat не собирает и не показывает.</p>
      </section>

      <section className="glass mt-4 space-y-2 rounded-3xl p-5"><h2 className="font-semibold">Заблокированные</h2>
        {blocks.data?.length === 0 && <p className="text-sm text-muted-foreground">Список пуст</p>}
        {blocks.data?.map((u) => <div key={u.id} className="flex items-center gap-3"><UserAvatar path={u.avatar_url} name={u.display_name || u.username} className="size-9" /><span className="flex-1 text-sm">@{u.username}</span>
          <Button size="sm" variant="outline" onClick={async () => { await table("blocks").delete().eq("blocker_id", user.id).eq("blocked_id", u.id); qc.invalidateQueries({ queryKey: ["blocks"] }); }}>Разблокировать</Button></div>)}</section>

      <section className="glass mt-4 space-y-2 rounded-3xl p-5"><h2 className="font-semibold">Активные сессии</h2>
        {sessions.isError && <p className="text-sm text-muted-foreground">Список сессий недоступен в этом окружении.</p>}
        {sessions.data?.list.map((s) => <p key={s.id} className="text-sm">{s.id === sessions.data.current ? <b>Это устройство · </b> : null}<span className="text-muted-foreground">{(s.user_agent || "неизвестное устройство").slice(0, 60)} · {new Date(s.refreshed_at ?? s.created_at).toLocaleString("ru-RU")}</span></p>)}
        <Button size="sm" variant="outline" onClick={async () => { const { error } = await supabase.auth.signOut({ scope: "others" }); if (error) toast.error("Не удалось"); else { toast.success("Другие устройства вышли"); sessions.refetch(); } }}>Выйти на других устройствах</Button></section>

      <section className="glass mt-4 space-y-2 rounded-3xl p-5"><h2 className="font-semibold">Ваши данные</h2>
        <Button size="sm" variant="outline" onClick={exportData}>Скачать мои данные (JSON)</Button>
        <p className="text-xs text-muted-foreground">Удаление аккаунта — в разделе <Link to="/profile" className="text-primary underline">Профиль</Link>.</p></section>
      <Button variant="ghost" className="mt-4 w-full" onClick={async () => { qc.clear(); await supabase.auth.signOut(); nav({ to: "/auth", replace: true }); }}>Выйти из аккаунта</Button>
    </Page>
  );
}
