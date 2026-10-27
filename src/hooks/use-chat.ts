import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table, type Msg } from "@/lib/db";
import type { Att } from "@/components/MessageBubble";

const PAGE = 30;
export type Receipt = { message_id: string; user_id: string; delivered_at: string | null; read_at: string | null };
export type Reaction = { message_id: string; user_id: string; emoji: string };

/** Загрузка истории (с пагинацией), realtime-обновления, реакции, квитанции, вложения. Всё приходит из БД. */
export function useChat(convId: string, myId: string, threadRoot?: string | null) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [atts, setAtts] = useState<Att[]>([]);
  const [typing, setTyping] = useState<string[]>([]);
  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimers = useRef<Record<string, number>>({});
  const lastTypingSent = useRef(0);
  const idsRef = useRef<string[]>([]);

  const base = useCallback(() => {
    let q = table("messages").select("*").eq("conversation_id", convId);
    q = threadRoot ? q.eq("thread_root_id", threadRoot) : q.is("thread_root_id", null);
    return q;
  }, [convId, threadRoot]);

  const merge = useCallback((incoming: Msg[]) => {
    setMsgs((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) {
        // убираем локальную «отправляется»-копию с тем же client_id
        for (const [k, v] of map) if (v._status && v.client_id === m.client_id && k !== m.id) map.delete(k);
        map.set(m.id, m);
      }
      return [...map.values()].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    });
  }, []);

  const loadAux = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    const [r, rc, at] = await Promise.all([
      table("message_reactions").select("*").in("message_id", ids),
      table("message_receipts").select("*").in("message_id", ids),
      table("attachments").select("*").in("message_id", ids),
    ]);
    const have = new Set(ids);
    setReactions((p) => [...p.filter((x) => !have.has(x.message_id)), ...((r.data ?? []) as Reaction[])]);
    setReceipts((p) => [...p.filter((x) => !have.has(x.message_id)), ...((rc.data ?? []) as Receipt[])]);
    setAtts((p) => [...p.filter((x) => !have.has(x.message_id)), ...((at.data ?? []) as Att[])]);
  }, []);

  useEffect(() => {
    setMsgs([]); setLoading(true);
    let alive = true;
    (async () => {
      const { data } = await base().order("created_at", { ascending: false }).limit(PAGE);
      if (!alive) return;
      const rows = ((data ?? []) as Msg[]).reverse();
      setMsgs(rows); setHasMore((data ?? []).length === PAGE); setLoading(false);
      loadAux(rows.map((m) => m.id));
      const incoming = rows.filter((m) => m.sender_id !== myId).map((m) => m.id);
      if (incoming.length) rpc("mark_delivered", { _ids: incoming }).catch(() => {});
    })();
    return () => { alive = false; };
  }, [base, loadAux, myId, threadRoot]);

  useEffect(() => { idsRef.current = msgs.filter((m) => !m._status).map((m) => m.id); }, [msgs]);

  useEffect(() => {
    let t: number | undefined;
    const refreshAux = () => { clearTimeout(t); t = window.setTimeout(() => loadAux(idsRef.current), 400); };
    const ch = supabase.channel(`conv:${convId}${threadRoot ? ":t" : ""}`, { config: { private: true, broadcast: { self: false } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` }, (p) => {
        const m = p.new as Msg;
        if ((m.thread_root_id ?? null) !== (threadRoot ?? null)) return;
        merge([m]);
        if (m.sender_id !== myId) rpc("mark_delivered", { _ids: [m.id] }).catch(() => {});
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `conversation_id=eq.${convId}` }, (p) => merge([p.new as Msg]))
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, refreshAux)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_receipts" }, refreshAux)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const who = String(payload?.name ?? "");
        if (!who) return;
        setTyping((p) => (p.includes(who) ? p : [...p, who]));
        clearTimeout(typingTimers.current[who]);
        typingTimers.current[who] = window.setTimeout(() => setTyping((p) => p.filter((x) => x !== who)), 4000);
      })
      .subscribe();
    chanRef.current = ch;
    return () => { clearTimeout(t); Object.values(typingTimers.current).forEach(clearTimeout); supabase.removeChannel(ch); chanRef.current = null; };
  }, [convId, myId, threadRoot, merge, loadAux]);

  const loadOlder = async () => {
    const first = msgs.find((m) => !m._status);
    if (!first) return;
    const { data } = await base().lt("created_at", first.created_at).order("created_at", { ascending: false }).limit(PAGE);
    const rows = ((data ?? []) as Msg[]).reverse();
    merge(rows); setHasMore((data ?? []).length === PAGE); loadAux(rows.map((m) => m.id));
  };

  const sendTyping = (name: string) => {
    if (Date.now() - lastTypingSent.current < 2500) return;
    lastTypingSent.current = Date.now();
    chanRef.current?.send({ type: "broadcast", event: "typing", payload: { name } });
  };

  return { msgs, setMsgs, merge, loading, hasMore, loadOlder, reactions, receipts, atts, typing, sendTyping, reload: () => loadAux(idsRef.current) };
}
