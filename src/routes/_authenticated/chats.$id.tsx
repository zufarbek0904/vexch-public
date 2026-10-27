import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, CornerUpLeft, Forward, Info, Pencil, Phone, Pin, Search, Trash2, Video, Flag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { convTitle, rpc, table, type ConvRow, type Msg } from "@/lib/db";
import { dayLabel, friendlyError, kindFromMime, parseMentions, receiptStatus, safeFileName } from "@/lib/chat-utils";
import { useChat } from "@/hooks/use-chat";
import { usePreferences } from "@/hooks/use-preferences";
import { useConversations } from "./chats.index";
import { Composer, type Outgoing } from "@/components/Composer";
import { ConversationInfo } from "@/components/ConversationInfo";
import { MessageBubble } from "@/components/MessageBubble";
import { ReportDialog, type ReportTarget } from "@/components/ReportDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { useCall } from "@/components/CallProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/chats/$id")({
  head: () => ({ meta: [{ title: "Чат — VexChat" }] }),
  component: Room,
});

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
type Member = { user_id: string; role: "owner" | "admin" | "member"; username: string | null; display_name: string | null; avatar_url: string | null };

function Room() {
  const { id } = Route.useParams();
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const convs = useConversations();
  const conv = convs.data?.find((c) => c.conversation_id === id);
  const prefs = usePreferences().data;
  const { startCall } = useCall();

  const members = useQuery({ queryKey: ["conv-members", id], enabled: !!conv, queryFn: () => rpc<Member[]>("conversation_members_detail", { _conv: id }) });
  const maxMb = useQuery({ queryKey: ["max-upload"], staleTime: 300_000, queryFn: async () => Number((await table("platform_settings").select("value").eq("key", "max_upload_mb").maybeSingle()).data?.value ?? 50) });
  const chat = useChat(id, user.id, null);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    (members.data ?? []).forEach((x) => m.set(x.user_id, x.display_name || x.username || "Удалённый аккаунт"));
    return m;
  }, [members.data]);

  const [text, setText] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [sel, setSel] = useState<Msg | null>(null);
  const [info, setInfo] = useState(false);
  const [forward, setForward] = useState<Msg | null>(null);
  const [comments, setComments] = useState<Msg | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sq, setSq] = useState("");
  const [sres, setSres] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const pending = useRef(new Map<string, Outgoing>());
  const bottom = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const draftLoaded = useRef(false);

  // черновик: загружаем один раз, сохраняем с задержкой
  useEffect(() => { if (conv && !draftLoaded.current) { draftLoaded.current = true; setText(conv.draft ?? ""); } }, [conv]);
  useEffect(() => {
    if (!draftLoaded.current || editing) return;
    const t = setTimeout(() => { table("conversation_members").update({ draft: text.trim() ? text : null }).eq("conversation_id", id).eq("user_id", user.id).then(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [text, editing, id, user.id]);

  // прочитано: пока вкладка открыта и видна
  useEffect(() => {
    if (!conv || document.hidden) return;
    const t = setTimeout(() => { rpc("mark_conversation_read", { _conv: id }).then(() => qc.invalidateQueries({ queryKey: ["conversations"] })).catch(() => {}); }, 600);
    return () => clearTimeout(t);
  }, [chat.msgs.length, conv, id, qc]);

  useEffect(() => { if (nearBottom.current) bottom.current?.scrollIntoView({ block: "end" }); }, [chat.msgs.length, chat.typing.length]);

  useEffect(() => {
    if (sq.trim().length < 2) { setSres([]); return; }
    const t = setTimeout(async () => { try { setSres(await rpc("search_messages", { _q: sq, _conv: id, _limit: 30 })); } catch { setSres([]); } }, 400);
    return () => clearTimeout(t);
  }, [sq, id]);

  const byId = useMemo(() => new Map(chat.msgs.map((m) => [m.id, m])), [chat.msgs]);

  async function upload(file: Blob, name: string, kind: ReturnType<typeof kindFromMime>, duration?: number) {
    const path = `${id}/${user.id}/${crypto.randomUUID()}-${safeFileName(name)}`;
    const mime = file.type || "application/octet-stream";
    const up = await supabase.storage.from("attachments").upload(path, file, { contentType: mime });
    if (up.error) throw new Error("Не удалось загрузить файл");
    return { storage_path: path, mime_type: mime, size_bytes: file.size, kind, duration_ms: duration ?? null };
  }

  async function deliver(o: Outgoing, clientId: string, extra: { reply_to_id?: string | null; forwarded_from_id?: string | null } = {}) {
    try {
      const ups: Awaited<ReturnType<typeof upload>>[] = [];
      for (const f of o.files) ups.push(await upload(f, f.name, kindFromMime(f.type)));
      if (o.voice) ups.push(await upload(o.voice.blob, "voice.webm", "voice", o.voice.durationMs));
      const row = {
        conversation_id: id, sender_id: user.id, client_id: clientId, body: o.body || null, scheduled_for: o.scheduledFor ?? null,
        mentions: parseMentions(o.body, members.data ?? []), reply_to_id: extra.reply_to_id ?? null, forwarded_from_id: extra.forwarded_from_id ?? null,
      };
      let { data, error } = await table("messages").insert(row).select().single();
      if (error?.code === "23505") { // повторная отправка после обрыва сети: сообщение уже сохранено
        ({ data, error } = await table("messages").select("*").eq("sender_id", user.id).eq("client_id", clientId).single());
      } else if (error?.code === "PGRST116") throw new Error("Сообщение отклонено: слишком частая отправка или чат недоступен");
      if (error) throw new Error(friendlyError(error.message));
      if (ups.length) {
        const { error: ae } = await table("attachments").insert(ups.map((u) => ({ ...u, message_id: data.id, conversation_id: id, uploader_id: user.id })));
        if (ae) toast.error("Сообщение отправлено, но вложение не сохранилось: " + friendlyError(ae.message));
      }
      pending.current.delete(clientId);
      chat.merge([data as Msg]);
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      chat.setMsgs((p) => p.map((m) => (m.client_id === clientId ? { ...m, _status: "failed" as const } : m)));
      toast.error((e as Error).message);
    }
  }

  async function send(o: Outgoing) {
    if (editing) {
      const { error } = await table("messages").update({ body: o.body }).eq("id", editing.id);
      if (error) toast.error(friendlyError(error.message)); else chat.merge([{ ...editing, body: o.body, edited_at: new Date().toISOString() }]);
      setEditing(null); setText(""); return;
    }
    const clientId = crypto.randomUUID();
    pending.current.set(clientId, o);
    const opt: Msg = { id: "tmp-" + clientId, conversation_id: id, sender_id: user.id, client_id: clientId, body: o.body || (o.voice ? "🎤 Голосовое" : o.files.length ? "📎 Вложение" : null), reply_to_id: reply?.id ?? null, forwarded_from_id: null, is_pinned: false, edited_at: null, deleted_at: null, expires_at: null, scheduled_for: o.scheduledFor ?? null, created_at: new Date().toISOString(), mentions: [], thread_root_id: null, _status: "sending" };
    chat.merge([opt]);
    setText(""); const r = reply; setReply(null);
    nearBottom.current = true;
    await deliver(o, clientId, { reply_to_id: r?.id });
  }

  const retry = (m: Msg) => {
    const o = pending.current.get(m.client_id);
    if (!o) { chat.setMsgs((p) => p.filter((x) => x.client_id !== m.client_id)); return; }
    chat.setMsgs((p) => p.map((x) => (x.client_id === m.client_id ? { ...x, _status: "sending" as const } : x)));
    deliver(o, m.client_id, { reply_to_id: m.reply_to_id });
  };

  async function react(m: Msg, emoji: string) {
    const mine = chat.reactions.some((r) => r.message_id === m.id && r.user_id === user.id && r.emoji === emoji);
    const res = mine
      ? await table("message_reactions").delete().eq("message_id", m.id).eq("user_id", user.id).eq("emoji", emoji)
      : await table("message_reactions").insert({ message_id: m.id, user_id: user.id, emoji });
    if (res.error) toast.error(friendlyError(res.error.message)); else chat.reload();
    setSel(null);
  }
  const act = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); ok && toast.success(ok); } catch (e) { toast.error((e as Error).message); } setSel(null); };

  async function forwardTo(target: ConvRow) {
    if (!forward) return;
    const f = forward; setForward(null);
    try {
      const { error } = await table("messages").insert({ conversation_id: target.conversation_id, sender_id: user.id, client_id: crypto.randomUUID(), body: f.body, forwarded_from_id: f.id });
      if (error) throw new Error(friendlyError(error.message));
      toast.success("Переслано в «" + convTitle(target) + "»");
    } catch (e) { toast.error((e as Error).message); }
  }

  if (convs.isLoading) return <main className="p-6 text-muted-foreground">Загрузка…</main>;
  if (!conv) return <NotMember id={id} />;

  const isChannel = conv.kind === "channel";
  const canPost = !conv.is_restricted && (!isChannel || conv.my_role !== "member");
  const title = convTitle(conv);
  const pinned = [...chat.msgs].reverse().find((m) => m.is_pinned && !m.deleted_at);
  const subtitle = chat.typing.length ? `${chat.typing.join(", ")} печатает…` : conv.kind === "direct" ? `@${conv.other_username ?? ""}` : conv.kind === "saved" ? "Личные заметки" : `${members.data?.length ?? "…"} ${isChannel ? "подписчиков" : "участников"}`;
  let lastDay = "";

  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-2xl flex-col px-3 pt-[env(safe-area-inset-top)]">
      <header className="glass-strong mt-2 flex items-center gap-2 rounded-2xl p-2">
        <Button asChild size="icon" variant="ghost" aria-label="Назад"><Link to="/chats"><ArrowLeft /></Link></Button>
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setInfo(true)}>
          <UserAvatar path={conv.kind === "direct" ? conv.other_avatar_url : conv.avatar_url} name={title} className="size-10" />
          <span className="min-w-0"><b className="block truncate">{title}</b><span className="block truncate text-xs text-muted-foreground">{subtitle}</span></span>
        </button>
        <Button size="icon" variant="ghost" aria-label="Поиск" onClick={() => setSearchOpen(!searchOpen)}><Search /></Button>
        {conv.kind === "direct" && <>
          <Button size="icon" variant="ghost" aria-label="Аудиозвонок" onClick={() => startCall(id, "audio")}><Phone /></Button>
          <Button size="icon" variant="ghost" aria-label="Видеозвонок" onClick={() => startCall(id, "video")}><Video /></Button></>}
        <Button size="icon" variant="ghost" aria-label="Информация" onClick={() => setInfo(true)}><Info /></Button>
      </header>

      {searchOpen && (
        <div className="glass mt-2 space-y-1 rounded-2xl p-2"><Input autoFocus placeholder="Поиск в этом чате" value={sq} onChange={(e) => setSq(e.target.value)} />
          {sres.map((r) => <button key={r.id} onClick={() => { const el = document.getElementById(`m-${r.id}`); if (el) { el.scrollIntoView({ block: "center" }); setSearchOpen(false); } else toast.info("Сообщение старое — загрузите историю выше"); }} className="block w-full truncate rounded-lg p-2 text-left text-sm hover:bg-accent">{r.body}</button>)}</div>
      )}
      {pinned && <button onClick={() => document.getElementById(`m-${pinned.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="glass mt-2 flex items-center gap-2 truncate rounded-xl px-3 py-1.5 text-left text-xs"><Pin className="size-3 shrink-0 text-primary" /><span className="truncate">{pinned.body || "Вложение"}</span></button>}

      <div className="flex-1 space-y-2 overflow-y-auto py-3" onScroll={(e) => { const t = e.currentTarget; nearBottom.current = t.scrollHeight - t.scrollTop - t.clientHeight < 120; }}>
        {chat.hasMore && <Button variant="ghost" size="sm" className="mx-auto flex" onClick={chat.loadOlder}>Показать ранее</Button>}
        {chat.loading && <p className="text-center text-sm text-muted-foreground">Загрузка…</p>}
        {!chat.loading && chat.msgs.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Сообщений пока нет{canPost ? ". Напишите первым." : "."}</p>}
        {chat.msgs.map((m) => {
          const d = dayLabel(m.created_at);
          const sep = d !== lastDay ? (lastDay = d) : null;
          const mine = m.sender_id === user.id;
          const status = m._status ?? receiptStatus(chat.receipts.filter((r) => r.message_id === m.id));
          return (
            <div key={m.id}>
              {sep && <p className="my-2 text-center text-xs text-muted-foreground">{sep}</p>}
              <MessageBubble m={m} mine={mine} myId={user.id} senderName={conv.kind === "group" ? nameOf.get(m.sender_id) ?? "Удалённый аккаунт" : null}
                replyTo={m.reply_to_id ? byId.get(m.reply_to_id) : undefined} reactions={chat.reactions.filter((r) => r.message_id === m.id)}
                attachments={chat.atts.filter((a) => a.message_id === m.id)} status={status} onReact={(e) => react(m, e)} onRetry={() => retry(m)}
                onAction={() => !m._status && setSel(m)} commentCount={isChannel ? 0 : undefined} />
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <div className="pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Composer value={text} onChange={setText} onTyping={() => chat.sendTyping(nameOf.get(user.id) || "Кто-то")} enterSends={prefs?.enter_sends ?? true} maxMb={maxMb.data ?? 50}
          disabled={!canPost} disabledReason={conv.is_restricted ? "Чат ограничен модерацией" : "Публиковать могут только администраторы канала"}
          banner={editing ? "Редактирование сообщения" : reply ? `Ответ: ${(reply.body || "Вложение").slice(0, 60)}` : null}
          onCancelBanner={() => { setReply(null); if (editing) { setEditing(null); setText(""); } }} onSend={send} />
      </div>

      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>Сообщение</SheetTitle></SheetHeader>
          {sel && !sel.deleted_at && (
            <div className="mt-3 space-y-1">
              <div className="flex justify-between pb-2">{EMOJIS.map((e) => <button key={e} className="rounded-full p-2 text-2xl hover:bg-accent" onClick={() => react(sel, e)}>{e}</button>)}</div>
              {canPost && <Button variant="ghost" className="w-full justify-start" onClick={() => { setReply(sel); setSel(null); }}><CornerUpLeft /> Ответить</Button>}
              {sel.body && <Button variant="ghost" className="w-full justify-start" onClick={() => { navigator.clipboard.writeText(sel.body!); toast.success("Скопировано"); setSel(null); }}><Copy /> Копировать</Button>}
              {sel.sender_id === user.id && sel.body && <Button variant="ghost" className="w-full justify-start" onClick={() => { setEditing(sel); setText(sel.body!); setSel(null); }}><Pencil /> Изменить</Button>}
              <Button variant="ghost" className="w-full justify-start" onClick={() => { setForward(sel); setSel(null); }}><Forward /> Переслать</Button>
              <Button variant="ghost" className="w-full justify-start" onClick={() => act(() => rpc("pin_message", { _id: sel.id, _pin: !sel.is_pinned }))}><Pin /> {sel.is_pinned ? "Открепить" : "Закрепить"}</Button>
              {isChannel && <Button variant="ghost" className="w-full justify-start" onClick={() => { setComments(sel); setSel(null); }}>Комментарии</Button>}
              {sel.sender_id !== user.id && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => { setReport({ message: sel.id }); setSel(null); }}><Flag /> Пожаловаться</Button>}
              {(sel.sender_id === user.id || (conv.kind !== "direct" && conv.my_role !== "member")) && <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => act(() => rpc("delete_message", { _id: sel.id }))}><Trash2 /> Удалить</Button>}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!forward} onOpenChange={(o) => !o && setForward(null)}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-3xl"><SheetHeader><SheetTitle>Переслать в…</SheetTitle></SheetHeader>
          <ul className="mt-3 space-y-1">{(convs.data ?? []).filter((c) => c.kind !== "channel" || c.my_role !== "member").map((c) => (
            <li key={c.conversation_id}><button className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent" onClick={() => forwardTo(c)}><UserAvatar path={c.kind === "direct" ? c.other_avatar_url : c.avatar_url} name={convTitle(c)} className="size-9" />{convTitle(c)}</button></li>))}</ul>
          <p className="mt-2 text-xs text-muted-foreground">Пересылается текст сообщения (вложения не копируются).</p></SheetContent>
      </Sheet>

      {comments && <CommentsSheet post={comments} convId={id} myId={user.id} onClose={() => setComments(null)} />}
      <ConversationInfo conv={conv} myId={user.id} open={info} onClose={() => setInfo(false)} members={members.data ?? []} />
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </main>
  );
}

function CommentsSheet({ post, convId, myId, onClose }: { post: Msg; convId: string; myId: string; onClose: () => void }) {
  const chat = useChat(convId, myId, post.id);
  const [t, setT] = useState("");
  const enabled = useQuery({ queryKey: ["comments-enabled", convId], queryFn: async () => (await table("channels").select("comments_enabled").eq("conversation_id", convId).single()).data?.comments_enabled === true });
  async function send() {
    if (!t.trim()) return;
    const { error } = await table("messages").insert({ conversation_id: convId, sender_id: myId, client_id: crypto.randomUUID(), body: t.trim(), thread_root_id: post.id });
    if (error) toast.error(friendlyError(error.message)); else setT("");
  }
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl"><SheetHeader><SheetTitle>Комментарии</SheetTitle></SheetHeader>
        {enabled.data === false && <p className="mt-3 text-sm text-muted-foreground">Комментарии к этому каналу отключены.</p>}
        <ul className="mt-3 space-y-2">{chat.msgs.map((m) => <li key={m.id} className="glass rounded-xl p-2 text-sm">{m.deleted_at ? <i>удалено</i> : m.body}</li>)}</ul>
        {enabled.data && <div className="mt-3 flex gap-2"><Input value={t} onChange={(e) => setT(e.target.value)} placeholder="Ваш комментарий" maxLength={1000} /><Button onClick={send}>Отправить</Button></div>}
      </SheetContent>
    </Sheet>
  );
}

function NotMember({ id }: { id: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["public-conv", id], queryFn: async () => (await table("conversations").select("id, kind, title, description, is_public").eq("id", id).maybeSingle()).data });
  if (q.isLoading) return <main className="p-6 text-muted-foreground">Загрузка…</main>;
  const c = q.data;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-4">
      <section className="glass rounded-3xl p-6 text-center">
        {c?.is_public ? <>
          <h1 className="text-xl font-bold">{c.title}</h1><p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
          <Button className="mt-4 bg-gradient-primary text-primary-foreground" onClick={async () => { try { await rpc("join_conversation", { _conv: id }); await qc.invalidateQueries({ queryKey: ["conversations"] }); } catch (e) { toast.error((e as Error).message); } }}>{c.kind === "channel" ? "Подписаться" : "Вступить"}</Button></>
          : <><h1 className="text-xl font-bold">Чат недоступен</h1><p className="mt-1 text-sm text-muted-foreground">Он не существует или вы не участник.</p></>}
        <Button asChild variant="ghost" className="mt-2"><Link to="/chats">К чатам</Link></Button>
      </section>
    </main>
  );
}
