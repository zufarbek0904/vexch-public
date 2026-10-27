import { useEffect, useRef, useState } from "react";
import { CalendarClock, Mic, Paperclip, Send, Square, X } from "lucide-react";
import { toast } from "sonner";
import { formatDuration } from "@/lib/chat-utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export type Outgoing = { body: string; files: File[]; voice?: { blob: Blob; durationMs: number }; scheduledFor?: string };
const MAX_FILES = 5;

export function Composer({ value, onChange, onSend, onTyping, disabled, disabledReason, enterSends, banner, onCancelBanner, maxMb }: {
  value: string; onChange: (v: string) => void; onSend: (o: Outgoing) => void; onTyping: () => void; disabled?: boolean; disabledReason?: string;
  enterSends: boolean; banner?: string | null; onCancelBanner: () => void; maxMb: number;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [rec, setRec] = useState<{ mr: MediaRecorder; start: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [when, setWhen] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!rec) return;
    const i = setInterval(() => setSecs((Date.now() - rec.start) / 1000), 250);
    return () => clearInterval(i);
  }, [rec]);
  useEffect(() => { const t = taRef.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 140) + "px"; } }, [value]);

  if (disabled) return <div className="glass-strong rounded-2xl p-3 text-center text-sm text-muted-foreground">{disabledReason}</div>;

  const submit = () => {
    if (!value.trim() && !files.length) return;
    if (when && new Date(when) <= new Date()) { toast.error("Время отправки должно быть в будущем"); return; }
    onSend({ body: value.trim(), files, scheduledFor: when ? new Date(when).toISOString() : undefined });
    setFiles([]); setWhen("");
  };

  async function toggleRec() {
    if (rec) { rec.mr.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.error("Запись звука не поддерживается браузером"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const start = Date.now();
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        const durationMs = Date.now() - start;
        if (durationMs < 600) return;
        onSend({ body: "", files: [], voice: { blob: new Blob(chunks, { type: mr.mimeType || "audio/webm" }), durationMs } });
      };
      mr.start(); setRec({ mr, start }); setSecs(0);
    } catch { toast.error("Нет доступа к микрофону"); }
  }

  return (
    <div className="glass-strong space-y-2 rounded-3xl p-2">
      {banner && <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-1.5 text-xs"><span className="flex-1 truncate">{banner}</span><button aria-label="Отменить" onClick={onCancelBanner}><X className="size-4" /></button></div>}
      {files.length > 0 && <div className="flex flex-wrap gap-1 px-1">{files.map((f, i) => (
        <span key={i} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">{f.name.slice(0, 24)}<button aria-label="Убрать" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button></span>))}</div>}
      {rec ? (
        <div className="flex items-center gap-3 px-2 py-1"><span className="size-2.5 animate-pulse rounded-full bg-destructive" /><span className="flex-1 text-sm">Запись… {formatDuration(secs)}</span>
          <Button size="icon" variant="destructive" onClick={toggleRec} aria-label="Остановить и отправить"><Square className="size-4" /></Button></div>
      ) : (
        <div className="flex items-end gap-1">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => {
            const picked = Array.from(e.target.files ?? []); e.target.value = "";
            const ok = picked.filter((f) => { if (f.size > maxMb * 1048576) { toast.error(`${f.name}: больше ${maxMb} МБ`); return false; } return true; });
            setFiles((p) => [...p, ...ok].slice(0, MAX_FILES));
          }} />
          <Button size="icon" variant="ghost" aria-label="Прикрепить" onClick={() => fileRef.current?.click()}><Paperclip /></Button>
          <textarea ref={taRef} rows={1} value={value} maxLength={4000} placeholder="Сообщение" aria-label="Сообщение"
            onChange={(e) => { onChange(e.target.value); onTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && enterSends && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            className="max-h-36 min-h-9 flex-1 resize-none rounded-xl bg-transparent px-2 py-2 text-sm outline-none" />
          <Popover>
            <PopoverTrigger asChild><Button size="icon" variant="ghost" aria-label="Отложенная отправка" className={when ? "text-primary" : ""}><CalendarClock /></Button></PopoverTrigger>
            <PopoverContent className="space-y-2">
              <p className="text-xs text-muted-foreground">Отправить позже. Получатель увидит сообщение только в это время.</p>
              <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              {when && <Button size="sm" variant="ghost" onClick={() => setWhen("")}>Сбросить</Button>}
            </PopoverContent>
          </Popover>
          {value.trim() || files.length ? <Button size="icon" className="bg-gradient-primary text-primary-foreground" onClick={submit} aria-label="Отправить"><Send /></Button>
            : <Button size="icon" variant="ghost" onClick={toggleRec} aria-label="Голосовое сообщение"><Mic /></Button>}
        </div>
      )}
    </div>
  );
}
