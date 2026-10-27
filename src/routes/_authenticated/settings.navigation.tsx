import { createFileRoute } from "@tanstack/react-router";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Lock, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { pushNav } from "@/lib/nav-sync";
import { Page } from "@/components/Page";
import { BottomNavigation } from "@/components/BottomNavigation";
import { Button } from "@/components/ui/button";
import { useNavConfig } from "@/hooks/use-nav-config";
import {
  ALL_SECTION_IDS,
  canAdd,
  canRemove,
  DEFAULT_NAV,
  MAX_TABS,
  NAV_SECTIONS,
  normalizeNav,
  type NavSectionId,
} from "@/lib/navigation";

export const Route = createFileRoute("/_authenticated/settings/navigation")({
  head: () => ({
    meta: [
      { title: "Нижняя панель — VexChat" },
      { name: "description", content: "Выберите и упорядочите вкладки нижней панели VexChat." },
      { property: "og:title", content: "Нижняя панель — VexChat" },
      { property: "og:description", content: "Настройка вкладок навигации." },
    ],
  }),
  component: NavEditor,
});

function Row({ id, onRemove, removable }: { id: NavSectionId; onRemove: () => void; removable: boolean }) {
  const controls = useDragControls();
  const s = NAV_SECTIONS[id];
  const Icon = s.icon;
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className="glass flex items-center gap-3 rounded-2xl px-3 py-3">
      <button
        type="button"
        aria-label={`Перетащить ${s.label}`}
        onPointerDown={(e) => controls.start(e)}
        className="touch-none cursor-grab p-1 text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-5" />
      </button>
      <Icon className="size-5" />
      <span className="flex-1 font-medium">{s.label}</span>
      {removable ? (
        <Button size="icon" variant="ghost" aria-label={`Убрать ${s.label}`} onClick={onRemove}>
          <Minus className="size-4" />
        </Button>
      ) : (
        <Lock className="mx-2.5 size-4 text-muted-foreground" aria-label="Обязательная вкладка" />
      )}
    </Reorder.Item>
  );
}

function NavEditor() {
  const saved = useNavConfig();
  const [draft, setDraft] = useState<NavSectionId[]>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const available = ALL_SECTION_IDS.filter((id) => !draft.includes(id));

  return (
    <Page title="Нижняя панель">
      <p className="mb-4 text-sm text-muted-foreground">
        До {MAX_TABS} вкладок. «Настройки» убрать нельзя. Настройка сохраняется в аккаунте и применяется на всех ваших устройствах.
      </p>

      <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
        Вкладки ({draft.length}/{MAX_TABS})
      </h2>
      <Reorder.Group axis="y" values={draft} onReorder={setDraft} className="mb-6 space-y-2">
        {draft.map((id) => (
          <Row key={id} id={id} removable={canRemove(draft, id)} onRemove={() => setDraft(draft.filter((x) => x !== id))} />
        ))}
      </Reorder.Group>

      {available.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Доступные разделы</h2>
          <div className="mb-6 space-y-2">
            {available.map((id) => {
              const s = NAV_SECTIONS[id];
              const Icon = s.icon;
              const ok = canAdd(draft, id);
              return (
                <div key={id} className="flex items-center gap-3 rounded-2xl border border-dashed border-glass-border px-3 py-3">
                  <Icon className="ml-8 size-5 text-muted-foreground" />
                  <span className="flex-1 text-muted-foreground">{s.label}</span>
                  <Button size="icon" variant="ghost" disabled={!ok} aria-label={`Добавить ${s.label}`} onClick={() => setDraft([...draft, id])}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Предпросмотр</h2>
      <div className="mb-6">
        <BottomNavigation items={normalizeNav(draft)} preview />
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => setDraft([...DEFAULT_NAV])}>
          <RotateCcw className="size-4" /> Сбросить
        </Button>
        <Button
          className="flex-1 bg-gradient-primary text-primary-foreground shadow-glow"
          disabled={!dirty}
          onClick={async () => {
            try {
              await pushNav(draft);
              toast.success("Навигация сохранена в аккаунте");
            } catch {
              toast.error("Не удалось сохранить. Проверьте подключение к сети");
            }
          }}
        >
          Сохранить
        </Button>
      </div>
    </Page>
  );
}
