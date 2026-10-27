import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { rpc } from "@/lib/db";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: Invite,
});

function Invite() {
  const { token } = Route.useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["invite", token], retry: false, queryFn: () => rpc<{ conversation_id: string; kind: string; title: string; description: string | null; member_count: number; valid: boolean }[]>("invite_preview", { _token: token }) });
  const p = q.data?.[0];
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <section className="glass rounded-3xl p-6 text-center">
        {q.isLoading ? <p className="text-muted-foreground">Проверяем ссылку…</p> : !p || !p.valid ? <><h1 className="text-xl font-bold">Ссылка недействительна</h1><p className="mt-1 text-sm text-muted-foreground">Она отозвана, истекла или исчерпана.</p></> : (
          <><h1 className="text-xl font-bold">{p.title}</h1><p className="mt-1 text-sm text-muted-foreground">{p.description}</p><p className="mt-1 text-xs text-muted-foreground">Участников: {p.member_count}</p>
            <Button className="mt-4 bg-gradient-primary text-primary-foreground" onClick={async () => { try { const id = await rpc<string>("join_by_invite", { _token: token }); nav({ to: "/chats/$id", params: { id } }); } catch (e) { toast.error((e as Error).message); } }}>Присоединиться</Button></>)}
        <Button variant="ghost" className="mt-2" onClick={() => nav({ to: "/chats" })}>К чатам</Button>
      </section>
    </main>
  );
}
