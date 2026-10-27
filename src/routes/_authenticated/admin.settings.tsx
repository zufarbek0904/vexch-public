import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { rpc, table } from "@/lib/db";
import { useAdminPerms } from "@/hooks/use-admin";
import { Card, Need, dt } from "@/components/AdminKit";
import { ReasonDialog } from "@/components/ReasonDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/settings")({ component: () => <Need perm="settings.view"><Settings /></Need> });
type Def = { key: string; label: string; type: "bool" | "int" | "text"; hint?: string; danger?: boolean; min?: number; max?: number };
const GROUPS: { title: string; items: Def[] }[] = [
  { title: "Платформа", items: [{ key: "platform_name", label: "Название", type: "text" }, { key: "logo_url", label: "Логотип (https-ссылка)", type: "text" }, { key: "acceptable_use", label: "Правила допустимого использования", type: "text" }] },
  { title: "Доступ", items: [{ key: "registration_open", label: "Регистрация открыта", type: "bool", danger: true, hint: "Если выключить, новые аккаунты создать нельзя" }, { key: "maintenance_mode", label: "Режим обслуживания", type: "bool", danger: true, hint: "Отправка сообщений только у сотрудников" }, { key: "maintenance_message", label: "Сообщение об обслуживании", type: "text" }] },
  { title: "Лимиты и антиспам", items: [{ key: "messages_per_minute", label: "Сообщений в минуту на пользователя", type: "int", min: 5, max: 120, hint: "Значение меньше 10 считается опасным" }, { key: "groups_per_day", label: "Групп/каналов в сутки", type: "int", min: 1, max: 50 }, { key: "invites_per_hour", label: "Приглашений в час", type: "int", min: 5, max: 200 }, { key: "reports_per_hour", label: "Жалоб в час", type: "int", min: 3, max: 50 }, { key: "max_message_length", label: "Макс. длина сообщения", type: "int", min: 100, max: 4000 }, { key: "max_upload_mb", label: "Макс. размер файла, МБ", type: "int", min: 1, max: 50 }] },
  { title: "Функции", items: [{ key: "group_creation_enabled", label: "Создание групп и каналов", type: "bool" }, { key: "public_channels_enabled", label: "Публичные группы и каналы", type: "bool" }] },
];

function Settings() {
  const qc = useQueryClient();
  const canEdit = useAdminPerms().data?.perms.has("settings.edit");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [dlg, setDlg] = useState<{ def: Def; value: unknown } | null>(null);
  const s = useQuery({ queryKey: ["admin-settings"], queryFn: async () => Object.fromEntries(((await table("platform_settings").select("*")).data ?? []).map((r: { key: string; value: unknown; updated_at: string }) => [r.key, r])) as Record<string, { value: unknown; updated_at: string }> });
  const cur = (k: string) => (k in draft ? draft[k] : s.data?.[k]?.value);
  const apply = async (def: Def, value: unknown, reason: string, confirm: boolean) => {
    try { await rpc("admin_update_setting", { _key: def.key, _value: value, _reason: reason, _confirm: confirm }); toast.success("Сохранено, записано в журнал"); setDraft((d) => { const n = { ...d }; delete n[def.key]; return n; }); qc.invalidateQueries({ queryKey: ["admin-settings"] }); qc.invalidateQueries({ queryKey: ["maintenance"] }); }
    catch (e) { toast.error((e as Error).message); throw e; }
  };
  const isDanger = (d: Def, v: unknown) => !!d.danger || (d.key === "messages_per_minute" && Number(v) < 10);
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => (
        <Card key={g.title} title={g.title}><div className="space-y-3">{g.items.map((d) => (
          <div key={d.key} className="flex flex-wrap items-center gap-3 text-sm"><div className="min-w-0 flex-1"><p>{d.label}{d.danger && <span className="ml-1 text-xs text-warning">опасная</span>}</p>{d.hint && <p className="text-xs text-muted-foreground">{d.hint}</p>}<p className="text-[10px] text-muted-foreground">изменено {dt(s.data?.[d.key]?.updated_at)}</p></div>
            {d.type === "bool" ? <Switch disabled={!canEdit} checked={cur(d.key) === true} onCheckedChange={(v) => setDlg({ def: d, value: v })} />
              : <><Input className="w-56" disabled={!canEdit} type={d.type === "int" ? "number" : "text"} min={d.min} max={d.max} value={String(cur(d.key) ?? "")} onChange={(e) => setDraft({ ...draft, [d.key]: d.type === "int" ? Number(e.target.value) : e.target.value })} />
                {canEdit && d.key in draft && <Button size="sm" onClick={() => setDlg({ def: d, value: draft[d.key] })}>Сохранить</Button>}</>}
          </div>))}</div></Card>))}
      <p className="text-xs text-muted-foreground">Каждое изменение проверяется сервером (допустимые диапазоны), требует причину и попадает в журнал аудита. Полностью отключить защиту одной настройкой нельзя: у лимитов есть нижние границы.</p>
      <ReasonDialog open={!!dlg} danger={!!dlg && isDanger(dlg.def, dlg.value)} needAck={!!dlg && isDanger(dlg.def, dlg.value)} title={dlg ? `Изменить: ${dlg.def.label}` : ""} description={dlg ? `Новое значение: ${String(dlg.value)}` : undefined} onClose={() => setDlg(null)}
        onConfirm={(r) => apply(dlg!.def, dlg!.value, r, isDanger(dlg!.def, dlg!.value))} />
    </div>
  );
}
