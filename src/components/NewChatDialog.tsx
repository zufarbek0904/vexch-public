import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bookmark, Search } from "lucide-react";
import { toast } from "sonner";
import { rpc, type PublicProfile } from "@/lib/db";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<PublicProfile[]>([]);
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) { setRes([]); return; }
    try { setRes(await rpc<PublicProfile[]>("search_users", { _q: v, _limit: 20 })); } catch (e) { toast.error((e as Error).message); }
  };
  const open1 = async (id: string) => {
    try { const conv = await rpc<string>("get_or_create_direct", { _other: id }); onClose(); nav({ to: "/chats/$id", params: { id: conv } }); } catch (e) { toast.error((e as Error).message); }
  };
  const saved = async () => {
    try { const conv = await rpc<string>("get_or_create_saved"); onClose(); nav({ to: "/chats/$id", params: { id: conv } }); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Новый чат</DialogTitle></DialogHeader>
        <div className="relative"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" autoFocus placeholder="Найти по @username или имени" value={q} onChange={(e) => search(e.target.value)} /></div>
        <Button variant="ghost" className="justify-start" onClick={saved}><Bookmark className="size-4" /> Избранное (личные заметки)</Button>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {res.map((u) => (
            <li key={u.id}><button onClick={() => open1(u.id)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent">
              <UserAvatar path={u.avatar_url} name={u.display_name || u.username} className="size-10" />
              <span><b className="block text-sm">{u.display_name || u.username}</b><span className="text-xs text-primary">@{u.username}</span></span>
            </button></li>
          ))}
          {q.trim().length >= 2 && res.length === 0 && <li className="p-2 text-sm text-muted-foreground">Никого не найдено</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
