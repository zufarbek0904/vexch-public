import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, MessageCircle, Phone, Search, UserMinus, UserPlus, X, Flag, Radio, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table } from "@/lib/db";
import { Page } from "@/components/Page";
import { UserAvatar } from "@/components/UserAvatar";
import { ReportDialog, type ReportTarget } from "@/components/ReportDialog";
import { useCall } from "@/components/CallProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Контакты — VexChat" }, { name: "description", content: "Контакты и поиск пользователей VexChat." }] }),
  component: ContactsPage,
});

type U = { id: string; username: string; display_name: string; avatar_url: string | null; bio?: string; is_contact?: boolean; is_blocked?: boolean };
type PubConv = { id: string; kind: "group" | "channel"; title: string; description: string | null; member_count: number; is_member: boolean; public_handle: string | null };

function ContactsPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { startCall } = useCall();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<U[]>([]);
  const [pubs, setPubs] = useState<PubConv[]>([]);
  const [report, setReport] = useState<ReportTarget | null>(null);

  const contacts = useQuery({
    queryKey: ["contacts"],
    queryFn: async (): Promise<U[]> => {
      const { data, error } = await table("contacts").select("contact_id, nickname, profiles!contacts_contact_id_fkey(id, username, display_name, avatar_url, bio)").eq("owner_id", user.id);
      if (error) throw new Error(error.message);
      return (data ?? []).filter((r: { profiles: U | null }) => r.profiles).map((r: { profiles: U; nickname: string | null }) => ({ ...r.profiles, display_name: r.nickname || r.profiles.display_name, is_contact: true }));
    },
  });
  const recent = useQuery({ queryKey: ["recent-search"], queryFn: async (): Promise<string[]> => ((await table("search_history").select("query").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10)).data ?? []).map((r: { query: string }) => r.query) });

  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) { setUsers([]); setPubs([]); return; }
    const t = setTimeout(async () => {
      try {
        const [u, p] = await Promise.all([rpc<U[]>("search_users", { _q: v }), rpc<PubConv[]>("search_public_conversations", { _q: v })]);
        setUsers(u); setPubs(p);
        await table("search_history").upsert({ user_id: user.id, query: v, created_at: new Date().toISOString() });
        qc.invalidateQueries({ queryKey: ["recent-search"] });
      } catch (e) { toast.error((e as Error).message); }
    }, 450);
    return () => clearTimeout(t);
  }, [q, user.id, qc]);

  const open = async (id: string, call?: "audio" | "video") => {
    try {
      const conv = await rpc<string>("get_or_create_direct", { _other: id });
      if (call) await startCall(conv, call); else nav({ to: "/chats/$id", params: { id: conv } });
    } catch (e) { toast.error((e as Error).message); }
  };
  const toggleContact = async (u: U) => {
    const r = u.is_contact ? await table("contacts").delete().eq("owner_id", user.id).eq("contact_id", u.id) : await table("contacts").insert({ owner_id: user.id, contact_id: u.id });
    if (r.error) toast.error("Не удалось изменить контакт"); else { qc.invalidateQueries({ queryKey: ["contacts"] }); setUsers((p) => p.map((x) => (x.id === u.id ? { ...x, is_contact: !u.is_contact } : x))); }
  };
  const block = async (u: U) => {
    if (!confirm(`Заблокировать @${u.username}?`)) return;
    const { error } = await table("blocks").insert({ blocker_id: user.id, blocked_id: u.id });
    if (error) toast.error("Не удалось заблокировать"); else { toast.success("Заблокирован"); setUsers((p) => p.filter((x) => x.id !== u.id)); qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["blocks"] }); }
  };
  const join = async (c: PubConv) => {
    try { await rpc("join_conversation", { _conv: c.id }); await qc.invalidateQueries({ queryKey: ["conversations"] }); nav({ to: "/chats/$id", params: { id: c.id } }); } catch (e) { toast.error((e as Error).message); }
  };

  const Row = ({ u }: { u: U }) => (
    <li className="glass flex items-center gap-3 rounded-2xl p-3">
      <UserAvatar path={u.avatar_url} name={u.display_name || u.username} />
      <div className="min-w-0 flex-1"><b className="block truncate">{u.display_name || u.username}</b><span className="text-xs text-primary">@{u.username}</span>{u.bio && <p className="truncate text-xs text-muted-foreground">{u.bio}</p>}</div>
      <Button size="icon" variant="ghost" aria-label="Написать" onClick={() => open(u.id)}><MessageCircle /></Button>
      <Button size="icon" variant="ghost" aria-label="Позвонить" onClick={() => open(u.id, "audio")}><Phone /></Button>
      <Button size="icon" variant="ghost" aria-label={u.is_contact ? "Удалить из контактов" : "В контакты"} onClick={() => toggleContact(u)}>{u.is_contact ? <UserMinus /> : <UserPlus />}</Button>
      <Button size="icon" variant="ghost" aria-label="Заблокировать" onClick={() => block(u)}><Ban /></Button>
      <Button size="icon" variant="ghost" aria-label="Пожаловаться" onClick={() => setReport({ user: u.id })}><Flag /></Button>
    </li>
  );

  const searching = q.trim().length >= 2;
  return (
    <Page title="Контакты">
      <div className="relative mb-4"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Поиск людей, групп и каналов" value={q} onChange={(e) => setQ(e.target.value)} /></div>

      {!searching && (recent.data?.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Недавние:</span>
          {recent.data!.map((r) => <button key={r} onClick={() => setQ(r)} className="rounded-full bg-muted px-3 py-1 text-xs">{r}</button>)}
          <button aria-label="Очистить историю" className="text-muted-foreground" onClick={async () => { await table("search_history").delete().eq("user_id", user.id); qc.invalidateQueries({ queryKey: ["recent-search"] }); }}><X className="size-4" /></button></div>
      )}

      {searching ? (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Люди</h2>
          <ul className="space-y-2">{users.map((u) => <Row key={u.id} u={u} />)}{users.length === 0 && <li className="text-sm text-muted-foreground">Никого не найдено</li>}</ul>
          <h2 className="mb-2 mt-6 text-sm font-semibold text-muted-foreground">Публичные группы и каналы</h2>
          <ul className="space-y-2">{pubs.map((c) => (
            <li key={c.id} className="glass flex items-center gap-3 rounded-2xl p-3">
              <span className="flex size-11 items-center justify-center rounded-full bg-secondary">{c.kind === "channel" ? <Radio /> : <UsersRound />}</span>
              <div className="min-w-0 flex-1"><b className="block truncate">{c.title}</b><span className="text-xs text-muted-foreground">{c.member_count} {c.kind === "channel" ? "подписчиков" : "участников"}{c.public_handle ? ` · @${c.public_handle}` : ""}</span></div>
              <Button size="sm" variant={c.is_member ? "outline" : "default"} onClick={() => (c.is_member ? nav({ to: "/chats/$id", params: { id: c.id } }) : join(c))}>{c.is_member ? "Открыть" : c.kind === "channel" ? "Подписаться" : "Вступить"}</Button>
            </li>))}{pubs.length === 0 && <li className="text-sm text-muted-foreground">Ничего не найдено</li>}</ul>
        </>
      ) : (
        <>
          {contacts.isLoading && <p className="text-muted-foreground">Загрузка…</p>}
          {!contacts.isLoading && (contacts.data?.length ?? 0) === 0 && <section className="glass rounded-3xl p-8 text-center"><p className="font-semibold">Контактов пока нет</p><p className="mt-1 text-sm text-muted-foreground">Найдите человека по @username выше и добавьте в контакты.</p></section>}
          <ul className="space-y-2">{contacts.data?.map((u) => <Row key={u.id} u={u} />)}</ul>
        </>
      )}
      <ReportDialog target={report} onClose={() => setReport(null)} />
    </Page>
  );
}
