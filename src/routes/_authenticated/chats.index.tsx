import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BellOff, MessageCircle, Pin, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { convTitle, rpc, table, type ConvRow, type Msg } from "@/lib/db";
import { formatTime, previewText } from "@/lib/chat-utils";
import { Page } from "@/components/Page";
import { UserAvatar } from "@/components/UserAvatar";
import { NewChatDialog } from "@/components/NewChatDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/chats/")({
  head: () => ({ meta: [{ title: "Чаты — VexChat" }, { name: "description", content: "Мессенджер VexChat: ваши диалоги." }] }),
  component: ChatsPage,
});

export function useConversations() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["conversations"], queryFn: () => rpc<ConvRow[]>("my_conversations") });
  useEffect(() => {
    let t: number | undefined;
    const refresh = () => { clearTimeout(t); t = window.setTimeout(() => qc.invalidateQueries({ queryKey: ["conversations"] }), 300); };
    const ch = supabase.channel("conv-list")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, refresh)
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [qc]);
  return q;
}

function ChatsPage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useConversations();
  const [showArchive, setShowArchive] = useState(false);
  const [filter, setFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [found, setFound] = useState<(Msg & { conversation_title: string | null })[]>([]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data ?? []).filter((c) => c.archived === showArchive && (!f || convTitle(c).toLowerCase().includes(f) || c.other_username?.includes(f)));
  }, [data, showArchive, filter]);

  useEffect(() => {
    const f = filter.trim();
    if (f.length < 2) { setFound([]); return; }
    const t = setTimeout(async () => { try { setFound(await rpc("search_messages", { _q: f, _limit: 20 })); } catch { setFound([]); } }, 400);
    return () => clearTimeout(t);
  }, [filter]);

  async function patch(c: ConvRow, p: Partial<Pick<ConvRow, "pinned" | "muted" | "archived">>) {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await table("conversation_members").update(p).eq("conversation_id", c.conversation_id).eq("user_id", u.user!.id);
    if (error) toast.error("Не удалось изменить"); else qc.invalidateQueries({ queryKey: ["conversations"] });
  }

  return (
    <Page title={showArchive ? "Архив" : "Чаты"} action={
      <div className="flex gap-1">
        <Button size="icon" variant="ghost" aria-label="Архив" onClick={() => setShowArchive(!showArchive)}><Archive className="size-5" /></Button>
        <Button size="icon" className="bg-gradient-primary text-primary-foreground" aria-label="Новый чат" onClick={() => setNewOpen(true)}><Plus className="size-5" /></Button>
      </div>}>
      <div className="relative mb-4"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Поиск по чатам и сообщениям" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>

      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-destructive">Не удалось загрузить чаты. Потяните страницу вниз или обновите её.</p>}
      {!isLoading && !error && rows.length === 0 && !found.length && (
        <section className="glass flex flex-col items-center rounded-3xl px-6 py-12 text-center">
          <MessageCircle className="mb-3 size-10 text-primary" />
          <h2 className="font-semibold">{showArchive ? "Архив пуст" : "Пока нет диалогов"}</h2>
          {!showArchive && <><p className="mt-1 text-sm text-muted-foreground">Найдите человека по @username и напишите ему.</p>
            <Button className="mt-4" onClick={() => setNewOpen(true)}>Начать чат</Button></>}
        </section>
      )}

      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.conversation_id} className="glass flex items-center rounded-2xl pr-1">
            <Link to="/chats/$id" params={{ id: c.conversation_id }} className="flex min-w-0 flex-1 items-center gap-3 p-3">
              <UserAvatar path={c.kind === "direct" ? c.other_avatar_url : c.avatar_url} name={convTitle(c)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <b className="truncate">{convTitle(c)}</b>
                  {c.pinned && <Pin className="size-3 text-muted-foreground" />}{c.muted && <BellOff className="size-3 text-muted-foreground" />}
                  <span className="ml-auto text-xs text-muted-foreground">{formatTime(c.last_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm text-muted-foreground">{c.draft ? <><span className="text-destructive">Черновик: </span>{c.draft}</> : previewText(c, !!c.last_at && c.last_sender_id !== null)}</p>
                  {c.unread_count > 0 && <span className="ml-auto min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-bold text-primary-foreground">{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
                </div>
              </div>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Действия">⋮</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => patch(c, { pinned: !c.pinned })}>{c.pinned ? "Открепить" : "Закрепить"}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => patch(c, { muted: !c.muted })}>{c.muted ? "Включить уведомления" : "Без звука"}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => patch(c, { archived: !c.archived })}>{c.archived ? "Из архива" : "В архив"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      {found.length > 0 && (
        <section className="mt-6"><h2 className="mb-2 text-sm font-semibold text-muted-foreground">Найдено в сообщениях</h2>
          <ul className="space-y-2">{found.map((m) => (
            <li key={m.id}><Link to="/chats/$id" params={{ id: m.conversation_id }} className="glass block rounded-2xl p-3">
              <p className="text-xs text-primary">{m.conversation_title || "Личный чат"} · {formatTime(m.created_at)}</p>
              <p className="line-clamp-2 text-sm">{m.body}</p></Link></li>))}</ul></section>
      )}
      <NewChatDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </Page>
  );
}
