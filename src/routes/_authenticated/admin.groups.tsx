import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc } from "@/lib/db";
import { Need, dt } from "@/components/AdminKit";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin/groups")({ component: () => <Need perm="groups.moderate"><Groups /></Need> });
type C = { id: string; kind: string; title: string; public_handle: string | null; is_public: boolean; is_restricted: boolean; member_count: number; owner_username: string | null; created_at: string; open_reports: number };

function Groups() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [dlg, setDlg] = useState<C | null>(null);
  const list = useQuery({ queryKey: ["admin-convs", q, kind], queryFn: () => rpc<C[]>("admin_list_conversations", { _q: q || null, _kind: kind, _limit: 50, _offset: 0 }) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2"><Input className="max-w-xs" placeholder="Название, @имя или ID" value={q} onChange={(e) => setQ(e.target.value)} />
        {[["all", "Все"], ["group", "Группы"], ["channel", "Каналы"]].map(([k, l]) => <Button key={k} size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{l}</Button>)}</div>
      <p className="text-xs text-muted-foreground">В списке только публичные группы и каналы, а также те, на которые поступили жалобы. Закрытые чаты без жалоб сотрудникам не показываются, содержимое не доступно.</p>
      <ul className="space-y-2">{list.data?.map((c) => (
        <li key={c.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl p-3 text-sm">
          <div className="min-w-0 flex-1"><b>{c.title}</b> <span className="text-xs text-muted-foreground">{c.kind === "channel" ? "канал" : "группа"}{c.public_handle ? ` · @${c.public_handle}` : ""} · {c.member_count} уч. · владелец @{c.owner_username ?? "?"} · {dt(c.created_at)}</span>
            {c.open_reports > 0 && <span className="ml-2 text-warning">жалоб: {c.open_reports}</span>}{c.is_restricted && <span className="ml-2 text-destructive">ограничен</span>}</div>
          <Button size="sm" variant={c.is_restricted ? "outline" : "destructive"} onClick={() => setDlg(c)}>{c.is_restricted ? "Снять ограничение" : "Ограничить"}</Button></li>))}
        {list.data?.length === 0 && <li className="text-sm text-muted-foreground">Ничего не найдено</li>}</ul>
      <ReasonDialog open={!!dlg} danger={!dlg?.is_restricted} title={dlg?.is_restricted ? "Снять ограничение" : "Ограничить публикации"} description="Пока чат ограничен, в нём нельзя отправлять сообщения." onClose={() => setDlg(null)}
        onConfirm={async (r) => { try { await rpc("admin_restrict_conversation", { _conv: dlg!.id, _restrict: !dlg!.is_restricted, _reason: r }); toast.success("Готово"); qc.invalidateQueries({ queryKey: ["admin-convs"] }); } catch (e) { toast.error((e as Error).message); throw e; } }} />
    </div>
  );
}
