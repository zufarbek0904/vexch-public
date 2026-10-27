import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/db";
import { friendlyError } from "@/lib/chat-utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const CATS = [["spam", "Спам"], ["abuse", "Оскорбления"], ["harassment", "Травля"], ["illegal", "Незаконный контент"], ["impersonation", "Выдаёт себя за другого"], ["other", "Другое"]] as const;
export type ReportTarget = { user?: string; conversation?: string; message?: string };

export function ReportDialog({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const [cat, setCat] = useState<string>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!target) return;
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await table("reports").insert({
      reporter_id: u.user!.id, category: cat, details: details.trim() || null,
      target_user_id: target.user ?? null, target_conversation_id: target.conversation ?? null, target_message_id: target.message ?? null,
    });
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success("Жалоба отправлена модераторам"); setDetails(""); onClose();
  }
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Пожаловаться</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">
          {CATS.map(([id, label]) => (
            <Button key={id} size="sm" variant={cat === id ? "default" : "outline"} onClick={() => setCat(id)}>{label}</Button>
          ))}
        </div>
        <Textarea placeholder="Что произошло? (необязательно)" maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
        <p className="text-xs text-muted-foreground">Модераторы увидят только то, на что вы жалуетесь, и несколько соседних сообщений. Остальная переписка им недоступна.</p>
        <Button onClick={send} disabled={busy}>Отправить</Button>
      </DialogContent>
    </Dialog>
  );
}
