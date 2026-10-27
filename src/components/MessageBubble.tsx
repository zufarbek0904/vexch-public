import { useState } from "react";
import { Check, CheckCheck, Clock, Download, FileText, Pin, AlertCircle, Forward, Timer } from "lucide-react";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { formatBytes, formatDuration, formatTime, type SendStatus } from "@/lib/chat-utils";
import type { Msg } from "@/lib/db";
import { cn } from "@/lib/utils";

export type Att = { id: string; message_id: string; storage_path: string; mime_type: string; size_bytes: number; kind: "image" | "video" | "document" | "voice"; duration_ms: number | null };

function AttachmentView({ a }: { a: Att }) {
  const url = useSignedUrl("attachments", a.storage_path);
  const [big, setBig] = useState(false);
  if (!url) return <div className="h-24 w-40 animate-pulse rounded-xl bg-muted" />;
  if (a.kind === "image") return <img src={url} alt="" loading="lazy" onClick={() => setBig(!big)} className={cn("cursor-zoom-in rounded-xl object-cover", big ? "max-h-[70vh] w-full" : "max-h-60")} />;
  if (a.kind === "video") return <video src={url} controls preload="metadata" className="max-h-60 rounded-xl" />;
  if (a.kind === "voice") return <div className="flex items-center gap-2"><audio src={url} controls preload="none" className="h-9 max-w-[220px]" /><span className="text-xs opacity-70">{formatDuration((a.duration_ms ?? 0) / 1000)}</span></div>;
  return <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-background/30 p-2 text-sm"><FileText className="size-5" /><span className="text-xs">{formatBytes(a.size_bytes)}</span><Download className="ml-auto size-4" /></a>;
}

export function StatusIcon({ s }: { s: SendStatus }) {
  if (s === "sending") return <Clock className="size-3" aria-label="Отправляется" />;
  if (s === "failed") return <AlertCircle className="size-3 text-destructive" aria-label="Не отправлено" />;
  if (s === "sent") return <Check className="size-3.5" aria-label="Отправлено" />;
  if (s === "delivered") return <CheckCheck className="size-3.5" aria-label="Доставлено" />;
  return <CheckCheck className="size-3.5 text-primary" aria-label="Прочитано" />;
}

export function MessageBubble({ m, mine, senderName, replyTo, reactions, myId, attachments, status, onReact, onAction, onRetry, commentCount }: {
  m: Msg; mine: boolean; senderName?: string | null; replyTo?: Msg; reactions: { emoji: string; user_id: string }[]; myId: string;
  attachments: Att[]; status: SendStatus; onReact: (emoji: string) => void; onAction: (e: React.MouseEvent) => void; onRetry: () => void; commentCount?: number;
}) {
  const grouped = Object.entries(reactions.reduce<Record<string, string[]>>((acc, r) => { (acc[r.emoji] ||= []).push(r.user_id); return acc; }, {}));
  const deleted = !!m.deleted_at;
  return (
    <div id={`m-${m.id}`} className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div onClick={onAction} onContextMenu={(e) => { e.preventDefault(); onAction(e); }} className={cn("max-w-[85%] space-y-1 rounded-2xl px-3 py-2 text-sm", mine ? "bg-gradient-primary text-primary-foreground" : "glass")}>
        {!mine && senderName && <p className="text-xs font-semibold text-primary">{senderName}</p>}
        {m.forwarded_from_id && <p className="flex items-center gap-1 text-xs opacity-70"><Forward className="size-3" /> Пересланное сообщение</p>}
        {replyTo && <button onClick={(e) => { e.stopPropagation(); document.getElementById(`m-${replyTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="block w-full truncate border-l-2 border-current pl-2 text-left text-xs opacity-80">{replyTo.deleted_at ? "Сообщение удалено" : replyTo.body || "Вложение"}</button>}
        {deleted ? <p className="italic opacity-70">Сообщение удалено</p> : (
          <>
            {attachments.map((a) => <AttachmentView key={a.id} a={a} />)}
            {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
          </>
        )}
        {grouped.length > 0 && <div className="flex flex-wrap gap-1">{grouped.map(([e, users]) => (
          <button key={e} onClick={(ev) => { ev.stopPropagation(); onReact(e); }} className={cn("rounded-full px-2 py-0.5 text-xs", users.includes(myId) ? "bg-background/60 ring-1 ring-current" : "bg-background/30")}>{e} {users.length}</button>))}</div>}
        <div className="flex items-center justify-end gap-1 text-[10px] opacity-70">
          {m.is_pinned && <Pin className="size-3" />}{m.expires_at && <Timer className="size-3" aria-label="Исчезающее" />}
          {m.scheduled_for && new Date(m.scheduled_for) > new Date() && <span>запланировано на {new Date(m.scheduled_for).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
          {m.edited_at && !deleted && <span>изменено</span>}
          <span>{formatTime(m.created_at)}</span>
          {mine && !deleted && (status === "failed" ? <button onClick={(ev) => { ev.stopPropagation(); onRetry(); }} className="underline">повторить</button> : <StatusIcon s={status} />)}
        </div>
        {commentCount !== undefined && <span className="block text-xs underline">Комментарии ({commentCount})</span>}
      </div>
    </div>
  );
}
