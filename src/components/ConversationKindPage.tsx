import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Radio, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { convTitle, rpc } from "@/lib/db";
import { useConversations } from "@/routes/_authenticated/chats.index";
import { Page } from "@/components/Page";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConversationKindPage({ kind }: { kind: "group" | "channel" }) {
  const isCh = kind === "channel";
  const { data, isLoading } = useConversations();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [pub, setPub] = useState(false);
  const [handle, setHandle] = useState("");
  const [comments, setComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = (data ?? []).filter((c) => c.kind === kind);
  const Icon = isCh ? Radio : UsersRound;

  async function create() {
    setBusy(true);
    try {
      const h = pub ? handle.trim().toLowerCase() : null;
      if (pub && !/^[a-z0-9_]{5,32}$/.test(h ?? "")) throw new Error("Публичное имя: 5–32 символа, латиница, цифры, «_»");
      const id = isCh ? await rpc<string>("create_channel", { _title: title, _description: desc, _public_handle: h, _comments: comments })
                      : await rpc<string>("create_group", { _title: title, _description: desc, _members: [], _public_handle: h });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
      setOpen(false); setTitle(""); setDesc(""); setHandle(""); setPub(false);
      nav({ to: "/chats/$id", params: { id } });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Page title={isCh ? "Каналы" : "Группы"} action={<Button size="icon" className="bg-gradient-primary text-primary-foreground" aria-label="Создать" onClick={() => setOpen(true)}><Plus /></Button>}>
      {isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {!isLoading && rows.length === 0 && (
        <section className="glass flex flex-col items-center rounded-3xl px-6 py-12 text-center"><Icon className="mb-3 size-10 text-primary" />
          <h2 className="font-semibold">{isCh ? "Вы не подписаны на каналы" : "Групп пока нет"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Создайте своё или найдите публичные через «Контакты» → поиск.</p>
          <Button className="mt-4" onClick={() => setOpen(true)}>Создать</Button></section>
      )}
      <ul className="space-y-2">{rows.map((c) => (
        <li key={c.conversation_id}><Link to="/chats/$id" params={{ id: c.conversation_id }} className="glass flex items-center gap-3 rounded-2xl p-3">
          <UserAvatar path={c.avatar_url} name={convTitle(c)} /><div className="min-w-0 flex-1"><b className="block truncate">{convTitle(c)}</b>
            <span className="text-xs text-muted-foreground">{c.is_public ? "Публичн" + (isCh ? "ый" : "ая") : "Приватн" + (isCh ? "ый" : "ая")} · {c.my_role === "owner" ? "владелец" : c.my_role === "admin" ? "админ" : isCh ? "подписчик" : "участник"}</span></div>
          {c.unread_count > 0 && <span className="rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground">{c.unread_count}</span>}</Link></li>))}</ul>

      <Dialog open={open} onOpenChange={setOpen}><DialogContent>
        <DialogHeader><DialogTitle>{isCh ? "Новый канал" : "Новая группа"}</DialogTitle></DialogHeader>
        <Input placeholder="Название" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea placeholder="Описание (необязательно)" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="flex items-center justify-between"><Label>Публичн{isCh ? "ый" : "ая"} (находится поиском)</Label><Switch checked={pub} onCheckedChange={setPub} /></div>
        {pub && <Input placeholder="Публичное имя, например my_team" maxLength={32} value={handle} onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))} />}
        {isCh && <div className="flex items-center justify-between"><Label>Разрешить комментарии</Label><Switch checked={comments} onCheckedChange={setComments} /></div>}
        <Button disabled={!title.trim() || busy} onClick={create}>Создать</Button>
      </DialogContent></Dialog>
    </Page>
  );
}
