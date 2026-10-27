import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Megaphone, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpc, table } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Status = { banned_at: string | null; suspended_until: string | null; reason: string | null } | null;

/** Баннеры системы + экран блокировки с формой апелляции. */
export function AccountGate({ userId, children }: { userId: string; children: ReactNode }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("vexchat.dismissed") || "[]"); } catch { return []; }
  });
  const [appeal, setAppeal] = useState("");
  const status = useQuery({ queryKey: ["account-status"], refetchInterval: 60_000, queryFn: async (): Promise<Status> => (await table("account_status").select("*").eq("user_id", userId).maybeSingle()).data ?? null });
  const sanction = useQuery({
    queryKey: ["my-sanction"], enabled: !!status.data?.banned_at,
    queryFn: async () => (await table("moderation_actions").select("id, action, reason, created_at").eq("target_user_id", userId).in("action", ["ban"]).is("revoked_at", null).order("created_at", { ascending: false }).limit(1)).data?.[0] ?? null,
  });
  const ann = useQuery({
    queryKey: ["announcements"], refetchInterval: 120_000,
    queryFn: async () => (await table("announcements").select("id, title, body, severity").eq("status", "published").lte("publish_at", new Date().toISOString()).order("publish_at", { ascending: false }).limit(3)).data ?? [],
  });
  const maint = useQuery({
    queryKey: ["maintenance"], refetchInterval: 120_000,
    queryFn: async () => {
      const { data } = await table("platform_settings").select("key, value").in("key", ["maintenance_mode", "maintenance_message"]);
      const m = Object.fromEntries((data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
      return { on: m.maintenance_mode === true, message: String(m.maintenance_message || "") };
    },
  });

  if (status.data?.banned_at) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <section className="glass rounded-3xl p-6">
          <ShieldAlert className="mb-3 size-10 text-destructive" />
          <h1 className="text-2xl font-bold">Аккаунт заблокирован</h1>
          {status.data.reason && <p className="mt-2 text-sm text-muted-foreground">Причина: {status.data.reason}</p>}
          {sanction.data && (
            <div className="mt-4 space-y-2">
              <p className="text-sm">Если считаете решение ошибочным, подайте апелляцию — её рассмотрит сотрудник.</p>
              <Textarea placeholder="Объясните ситуацию (от 10 символов)" value={appeal} maxLength={2000} onChange={(e) => setAppeal(e.target.value)} />
              <Button disabled={appeal.trim().length < 10} onClick={async () => {
                try { await rpc("file_appeal", { _action: sanction.data.id, _body: appeal }); toast.success("Апелляция отправлена"); setAppeal(""); } catch (e) { toast.error((e as Error).message); }
              }}>Отправить апелляцию</Button>
            </div>
          )}
          <Button variant="ghost" className="mt-4" onClick={async () => { qc.clear(); await supabase.auth.signOut(); nav({ to: "/auth", replace: true }); }}>Выйти</Button>
        </section>
      </main>
    );
  }

  const visible = (ann.data ?? []).filter((a: { id: string }) => !dismissed.includes(a.id));
  const suspended = status.data?.suspended_until && new Date(status.data.suspended_until) > new Date();
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    localStorage.setItem("vexchat.dismissed", JSON.stringify(next));
  };
  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 mx-auto max-w-2xl space-y-1 px-3 pt-[env(safe-area-inset-top)]">
        {maint.data?.on && <div className="glass-strong mt-1 rounded-xl px-3 py-2 text-xs text-warning">Идёт техническое обслуживание: отправка сообщений временно недоступна. {maint.data.message}</div>}
        {suspended && <div className="glass-strong mt-1 rounded-xl px-3 py-2 text-xs text-destructive">Ваш аккаунт ограничен до {new Date(status.data!.suspended_until!).toLocaleString("ru-RU")}: писать и звонить нельзя. {status.data?.reason}</div>}
        {visible.map((a: { id: string; title: string; body: string; severity: string }) => (
          <div key={a.id} className="glass-strong mt-1 flex items-start gap-2 rounded-xl px-3 py-2 text-xs">
            <Megaphone className={`mt-0.5 size-4 shrink-0 ${a.severity === "warning" || a.severity === "maintenance" ? "text-warning" : "text-primary"}`} />
            <div className="flex-1"><b>{a.title}</b> — {a.body} <span className="text-muted-foreground">(объявление системы)</span></div>
            <button aria-label="Скрыть" onClick={() => dismiss(a.id)}><X className="size-4" /></button>
          </div>
        ))}
      </div>
      {children}
    </>
  );
}
