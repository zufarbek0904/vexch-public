import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from "lucide-react";
import { table } from "@/lib/db";
import { formatDuration, formatTime } from "@/lib/chat-utils";
import { Page } from "@/components/Page";
import { UserAvatar } from "@/components/UserAvatar";
import { useCall } from "@/components/CallProvider";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/calls")({
  head: () => ({ meta: [{ title: "Звонки — VexChat" }, { name: "description", content: "История аудио- и видеозвонков VexChat." }] }),
  component: CallsPage,
});

type Call = { id: string; conversation_id: string; caller_id: string; callee_id: string; media: "audio" | "video"; status: string; started_at: string; connected_at: string | null; ended_at: string | null };
const STATUS: Record<string, string> = { ringing: "вызов", connected: "идёт", ended: "завершён", missed: "пропущен", declined: "отклонён", failed: "не удался" };

function CallsPage() {
  const { user } = Route.useRouteContext();
  const { startCall } = useCall();
  const q = useQuery({
    queryKey: ["calls"], refetchInterval: 15_000,
    queryFn: async () => {
      const calls: Call[] = (await table("calls").select("*").order("started_at", { ascending: false }).limit(50)).data ?? [];
      const ids = [...new Set(calls.map((c) => (c.caller_id === user.id ? c.callee_id : c.caller_id)))];
      const profs: { id: string; username: string; display_name: string; avatar_url: string | null }[] = ids.length ? (await table("profiles").select("id, username, display_name, avatar_url").in("id", ids)).data ?? [] : [];
      return { calls, profs: new Map(profs.map((p) => [p.id, p])) };
    },
  });
  return (
    <Page title="Звонки">
      {q.isLoading && <p className="text-muted-foreground">Загрузка…</p>}
      {!q.isLoading && !q.data?.calls.length && <section className="glass rounded-3xl p-8 text-center"><Phone className="mx-auto mb-2 size-9 text-primary" /><p className="font-semibold">История звонков пуста</p><p className="mt-1 text-sm text-muted-foreground">Позвонить можно из личного чата или контактов.</p></section>}
      <ul className="space-y-2">{q.data?.calls.map((c) => {
        const out = c.caller_id === user.id;
        const p = q.data!.profs.get(out ? c.callee_id : c.caller_id);
        const bad = c.status === "missed" || c.status === "declined" || c.status === "failed";
        const dur = c.connected_at && c.ended_at ? formatDuration((+new Date(c.ended_at) - +new Date(c.connected_at)) / 1000) : null;
        return (
          <li key={c.id} className="glass flex items-center gap-3 rounded-2xl p-3">
            <UserAvatar path={p?.avatar_url} name={p?.display_name || p?.username} />
            <div className="min-w-0 flex-1"><b className="block truncate">{p?.display_name || p?.username || "Удалённый аккаунт"}</b>
              <span className={`flex items-center gap-1 text-xs ${bad ? "text-destructive" : "text-muted-foreground"}`}>
                {bad && !out ? <PhoneMissed className="size-3" /> : out ? <PhoneOutgoing className="size-3" /> : <PhoneIncoming className="size-3" />}
                {c.media === "video" ? "видео" : "аудио"} · {STATUS[c.status] ?? c.status}{dur ? ` · ${dur}` : ""} · {formatTime(c.started_at)}</span></div>
            <Button size="icon" variant="ghost" aria-label="Позвонить" onClick={() => startCall(c.conversation_id, "audio")}><Phone /></Button>
            <Button size="icon" variant="ghost" aria-label="Видеозвонок" onClick={() => startCall(c.conversation_id, "video")}><Video /></Button>
          </li>);
      })}</ul>
    </Page>
  );
}
