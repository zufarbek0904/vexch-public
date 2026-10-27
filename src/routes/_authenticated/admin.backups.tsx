import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { useAdminPerms } from "@/hooks/use-admin";
import { Card, Need, dt } from "@/components/AdminKit";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/backups")({ component: () => <Need perm="backups.view"><Backups /></Need> });

function Backups() {
  const qc = useQueryClient();
  const canManage = useAdminPerms().data?.perms.has("backups.manage");
  const [dlg, setDlg] = useState<{ kind: string; ok: boolean } | null>(null);
  const q = useQuery({ queryKey: ["backups"], queryFn: async () => (await table("backup_records").select("*").order("recorded_at", { ascending: false }).limit(30)).data ?? [] as { id: string; kind: string; ok: boolean; note: string | null; recorded_at: string }[] });
  const lastOk = (q.data ?? []).find((r: { kind: string; ok: boolean }) => r.kind === "backup_check" && r.ok);
  return (
    <div className="space-y-4">
      <Card title="Состояние"><p className="text-sm">Последняя подтверждённая проверка копии: <b>{lastOk ? dt(lastOk.recorded_at) : "нет данных"}</b></p>
        <p className="mt-2 text-xs text-muted-foreground">Резервные копии делает платформа хостинга (Lovable Cloud / Supabase). VexChat не может автоматически прочитать их статус, поэтому здесь отображаются только отметки, которые сотрудники вносят вручную после реальной проверки. Если отметок нет — это «нет данных», а не «всё хорошо».</p></Card>
      {canManage && <Card title="Внести отметку"><div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setDlg({ kind: "backup_check", ok: true })}>Копия проверена: успешно</Button><Button size="sm" variant="destructive" onClick={() => setDlg({ kind: "backup_check", ok: false })}>Копия проверена: проблема</Button>
        <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "restore_test", ok: true })}>Тест восстановления: успешно</Button><Button size="sm" variant="outline" onClick={() => setDlg({ kind: "restore_test", ok: false })}>Тест восстановления: неудача</Button></div></Card>}
      <Card title="История отметок"><ul className="space-y-1 text-sm">{q.data?.map((r: { id: string; kind: string; ok: boolean; note: string | null; recorded_at: string }) => <li key={r.id}>{dt(r.recorded_at)} · {r.kind === "backup_check" ? "проверка копии" : "тест восстановления"} · {r.ok ? "успешно" : <span className="text-destructive">проблема</span>} {r.note && `— ${r.note}`}</li>)}{q.data?.length === 0 && <li className="text-muted-foreground">Отметок нет</li>}</ul></Card>
      <Card title="Как восстановить данные"><ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground"><li>Не запускайте восстановление на рабочей базе без согласования: оно перезапишет свежие данные.</li><li>Восстановите копию в отдельный проект и проверьте, что таблицы и пользователи на месте.</li><li>Запишите здесь отметку «Тест восстановления».</li><li>Для боевого восстановления используйте раздел резервных копий панели хостинга. Подробнее — docs/SETUP.md.</li></ol></Card>
      <ReasonDialog open={!!dlg} title="Отметка о резервной копии" description="Опишите, что именно вы проверили (источник, дата копии)." onClose={() => setDlg(null)}
        onConfirm={async (note) => { try { await rpc("admin_record_backup", { _kind: dlg!.kind, _ok: dlg!.ok, _note: note }); toast.success("Записано"); qc.invalidateQueries({ queryKey: ["backups"] }); } catch (e) { toast.error((e as Error).message); throw e; } }} />
    </div>
  );
}
