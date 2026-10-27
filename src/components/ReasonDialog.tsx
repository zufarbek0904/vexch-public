import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** Подтверждение опасного действия с обязательной причиной (попадает в журнал аудита). */
export function ReasonDialog({ open, title, description, confirmLabel = "Подтвердить", danger, needAck, onClose, onConfirm }: {
  open: boolean; title: string; description?: string; confirmLabel?: string; danger?: boolean; needAck?: boolean;
  onClose: () => void; onConfirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const ok = reason.trim().length >= 3 && (!needAck || ack);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setReason(""); setAck(false); onClose(); } }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        <Textarea placeholder="Причина (будет записана в журнал)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        {needAck && (
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} /> Я понимаю последствия</label>
        )}
        <Button variant={danger ? "destructive" : "default"} disabled={!ok || busy} onClick={async () => {
          setBusy(true);
          try { await onConfirm(reason.trim()); setReason(""); setAck(false); onClose(); } finally { setBusy(false); }
        }}>{busy ? "…" : confirmLabel}</Button>
      </DialogContent>
    </Dialog>
  );
}
