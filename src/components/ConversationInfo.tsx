import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Crown, Link2, LogOut, Shield, Trash2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { convTitle, rpc, table, type ConvRow } from "@/lib/db";
import { ttlLabel } from "@/lib/chat-utils";
import { UserAvatar } from "@/components/UserAvatar";
import { ReportDialog, type ReportTarget } from "@/components/ReportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Member = { user_id: string; role: "owner" | "admin" | "member"; username: string | null; display_name: string | null; avatar_url: string | null };
const TTLS = [0, 3600, 86400, 604800];
const guard = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.success(ok); return true; } catch (e) { toast.error((e as Error).message); return false; } };

export function ConversationInfo({ conv, myId, open, onClose, members }: { conv: ConvRow; myId: string; open: boolean; onClose: () => void; members: Member[] }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const isAdmin = conv.my_role === "owner" || conv.my_role === "admin";
  const isOwner = conv.my_role === "owner";
  const multi = conv.kind === "group" || conv.kind === "channel";
  const [title, setTitle] = useState(conv.title ?? "");
  const [desc, setDesc] = useState("");
  const [handle, setHandle] = useState("");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; username: string; display_name: string }[]>([]);
  const [link, setLink] = useState("");
  const [report, setReport] = useState<ReportTarget | null>(null);

  const meta = useQuery({
    queryKey: ["conv-meta", conv.conversation_id], enabled: open && multi,
    queryFn: async () => {
      const c = (await table("conversations").select("title, description, public_handle, is_public").eq("id", conv.conversation_id).single()).data;
      const extra = conv.kind === "group"
        ? (await table("groups").select("*").eq("conversation_id", conv.conversation_id).single()).data
        : (await table("channels").select("*").eq("conversation_id", conv.conversation_id).single()).data;
      setTitle(c?.title ?? ""); setDesc(c?.description ?? ""); setHandle(c?.public_handle ?? "");
      return { c, extra };
    },
  });
  const stats = useQuery({ queryKey: ["chan-stats", conv.conversation_id], enabled: open && conv.kind === "channel" && isAdmin, queryFn: () => rpc<{ subscribers: number; new_subscribers_7d: number; posts: number; total_views: number; recent_posts: { id: string; preview: string; views: number }[] }>("channel_stats", { _conv: conv.conversation_id }) });

  const refresh = () => { qc.invalidateQueries({ queryKey: ["conv-members", conv.conversation_id] }); qc.invalidateQueries({ queryKey: ["conversations"] }); qc.invalidateQueries({ queryKey: ["conv-meta", conv.conversation_id] }); };
  const personal = async (p: Partial<ConvRow>) => { await guard(async () => { const { error } = await table("conversation_members").update(p).eq("conversation_id", conv.conversation_id).eq("user_id", myId); if (error) throw new Error(error.message); refresh(); }); };

  async function saveMeta() {
    await guard(async () => {
      const { error } = await table("conversations").update({ title: title.trim(), description: desc.trim() || null, public_handle: handle.trim() ? handle.trim().toLowerCase() : null, is_public: !!handle.trim() }).eq("id", conv.conversation_id);
      if (error) throw new Error(error.message);
      refresh();
    }, "Сохранено");
  }
  async function toggleMeta(field: string, value: boolean) {
    const t = conv.kind === "group" ? "groups" : "channels";
    await guard(async () => { const { error } = await table(t).update({ [field]: value }).eq("conversation_id", conv.conversation_id); if (error) throw new Error(error.message); refresh(); });
  }
  async function search(v: string) {
    setQ(v);
    if (v.trim().length < 2) { setFound([]); return; }
    try { setFound(await rpc("search_users", { _q: v })); } catch { setFound([]); }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>{convTitle(conv)}</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-5 pb-8">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Для вас</h3>
            {([["muted", "Без звука"], ["pinned", "Закрепить чат"], ["archived", "В архиве"]] as const).map(([k, label]) => (
              <div key={k} className="flex items-center justify-between"><Label>{label}</Label><Switch checked={conv[k]} onCheckedChange={(v) => personal({ [k]: v })} /></div>))}
          </section>

          {(!multi || isAdmin) && conv.kind !== "saved" && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Исчезающие сообщения: {ttlLabel(conv.ttl_seconds)}</h3>
              <div className="flex flex-wrap gap-2">{TTLS.map((s) => (
                <Button key={s} size="sm" variant={(conv.ttl_seconds ?? 0) === s ? "default" : "outline"} onClick={() => guard(async () => { await rpc("set_disappearing", { _conv: conv.conversation_id, _seconds: s }); refresh(); })}>{ttlLabel(s)}</Button>))}</div>
              <p className="text-xs text-muted-foreground">Действует на новые сообщения. Это не гарантирует удаление: получатель мог сделать скриншот или сохранить копию.</p>
            </section>
          )}

          {multi && isAdmin && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Настройки</h3>
              <Input value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
              <Textarea value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} placeholder="Описание" />
              <Input value={handle} maxLength={32} onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} placeholder="Публичное имя (латиница, 5–32) — пусто = приватный" />
              <Button size="sm" onClick={saveMeta}>Сохранить</Button>
              {conv.kind === "group" && meta.data?.extra && <>
                <div className="flex items-center justify-between"><Label>Участники могут приглашать</Label><Switch checked={meta.data.extra.members_can_invite} onCheckedChange={(v) => toggleMeta("members_can_invite", v)} /></div>
                <div className="flex items-center justify-between"><Label>Участники могут закреплять</Label><Switch checked={meta.data.extra.members_can_pin} onCheckedChange={(v) => toggleMeta("members_can_pin", v)} /></div></>}
              {conv.kind === "channel" && meta.data?.extra && <div className="flex items-center justify-between"><Label>Комментарии к публикациям</Label><Switch checked={meta.data.extra.comments_enabled} onCheckedChange={(v) => toggleMeta("comments_enabled", v)} /></div>}
            </section>
          )}

          {conv.kind === "channel" && isAdmin && stats.data && (
            <section className="space-y-1 text-sm"><h3 className="font-semibold">Статистика</h3>
              <p>Подписчиков: {stats.data.subscribers} (+{stats.data.new_subscribers_7d} за 7 дней)</p><p>Публикаций: {stats.data.posts} · Просмотров: {stats.data.total_views}</p>
              {stats.data.recent_posts.slice(0, 5).map((p) => <p key={p.id} className="truncate text-xs text-muted-foreground">👁 {p.views} — {p.preview || "Вложение"}</p>)}</section>
          )}

          {multi && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Участники ({members.length})</h3>
              {isAdmin && <>
                <Input value={q} onChange={(e) => search(e.target.value)} placeholder="Добавить по @username" />
                {found.map((u) => <button key={u.id} className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-accent" onClick={() => guard(async () => { await rpc("add_conversation_member", { _conv: conv.conversation_id, _user: u.id }); setQ(""); setFound([]); refresh(); }, "Добавлен")}><UserPlus className="size-4" /> @{u.username}</button>)}</>}
              <ul className="space-y-1">{members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-2 rounded-lg p-1.5">
                  <UserAvatar path={m.avatar_url} name={m.display_name || m.username} className="size-9" />
                  <span className="flex-1 truncate text-sm">{m.display_name || m.username || "Удалённый аккаунт"} {m.role === "owner" && <Crown className="inline size-3 text-warning" />}{m.role === "admin" && <Shield className="inline size-3 text-primary" />}</span>
                  {isOwner && m.user_id !== myId && <>
                    <Button size="sm" variant="ghost" onClick={() => guard(async () => { await rpc("set_member_role", { _conv: conv.conversation_id, _user: m.user_id, _role: m.role === "admin" ? "member" : "admin" }); refresh(); })}>{m.role === "admin" ? "Снять админа" : "Админ"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("Передать владение этому участнику? Вы станете администратором.")) guard(async () => { await rpc("transfer_ownership", { _conv: conv.conversation_id, _user: m.user_id }); refresh(); }); }}><Crown className="size-4" /></Button></>}
                  {isAdmin && m.user_id !== myId && m.role !== "owner" && (isOwner || m.role === "member") && <Button size="icon" variant="ghost" aria-label="Удалить из чата" onClick={() => guard(async () => { await rpc("remove_conversation_member", { _conv: conv.conversation_id, _user: m.user_id }); refresh(); })}><UserMinus className="size-4" /></Button>}
                </li>))}</ul>
            </section>
          )}

          {multi && isAdmin && (
            <section className="space-y-2"><h3 className="text-sm font-semibold">Ссылка-приглашение</h3>
              <Button size="sm" variant="outline" onClick={() => guard(async () => { const t = await rpc<string>("create_invite_link", { _conv: conv.conversation_id, _expires_hours: 24 * 7, _max_uses: null }); setLink(`${location.origin}/invite/${t}`); })}><Link2 className="size-4" /> Создать (7 дней)</Button>
              {link && <div className="flex gap-1"><Input readOnly value={link} /><Button size="icon" variant="outline" aria-label="Копировать" onClick={() => { navigator.clipboard.writeText(link); toast.success("Скопировано"); }}><Copy /></Button>
                <Button size="icon" variant="outline" aria-label="Отозвать" onClick={() => guard(async () => { await rpc("revoke_invite_link", { _token: link.split("/").pop() }); setLink(""); }, "Ссылка отозвана")}><Trash2 /></Button></div>}
            </section>
          )}

          <section className="space-y-1">
            {conv.kind === "direct" && conv.other_user_id && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => setReport({ user: conv.other_user_id! })}>Пожаловаться на пользователя</Button>}
            {multi && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => setReport({ conversation: conv.conversation_id })}>Пожаловаться на {conv.kind === "group" ? "группу" : "канал"}</Button>}
            {multi && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => { if (confirm("Покинуть чат?")) guard(async () => { await rpc("leave_conversation", { _conv: conv.conversation_id }); await qc.invalidateQueries({ queryKey: ["conversations"] }); nav({ to: "/chats" }); }); }}><LogOut className="size-4" /> Покинуть</Button>}
            {conv.kind === "direct" && conv.other_user_id && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => { if (confirm("Заблокировать пользователя? Вы не сможете переписываться.")) guard(async () => { const { error } = await table("blocks").insert({ blocker_id: myId, blocked_id: conv.other_user_id }); if (error) throw new Error(error.message); await supabase.auth.getUser(); refresh(); }, "Пользователь заблокирован"); }}>Заблокировать</Button>}
          </section>
        </div>
        <ReportDialog target={report} onClose={() => setReport(null)} />
      </SheetContent>
    </Sheet>
  );
}
