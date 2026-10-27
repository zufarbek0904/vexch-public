import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Page } from "@/components/Page";
import { ACCENTS, DEFAULT_PREFS, usePreferences, useSavePrefs, type Prefs } from "@/hooks/use-preferences";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/settings/appearance")({
  head: () => ({ meta: [{ title: "Оформление — VexChat" }] }),
  component: Appearance,
});

function Appearance() {
  const p = usePreferences().data ?? DEFAULT_PREFS;
  const save = useSavePrefs();
  const set = (patch: Partial<Prefs>) => save(patch).catch((e) => toast.error(e.message));
  return (
    <Page title="Оформление">
      <section className="glass space-y-5 rounded-3xl p-5">
        <div className="space-y-2"><Label>Тема</Label><div className="flex gap-2">{(["dark", "light", "system"] as const).map((t) => (
          <Button key={t} variant={p.theme === t ? "default" : "outline"} className="flex-1" onClick={() => set({ theme: t })}>{{ dark: "Тёмная", light: "Светлая", system: "Системная" }[t]}</Button>))}</div></div>
        <div className="space-y-2"><Label>Акцентный цвет</Label><div className="flex gap-3">{Object.entries(ACCENTS).map(([k, a]) => (
          <button key={k} aria-label={a.label} onClick={() => set({ accent: k })} style={{ background: `linear-gradient(135deg, ${a.primary}, ${a.glow})` }} className={`size-10 rounded-full ${p.accent === k ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`} />))}</div></div>
        <div className="space-y-2"><Label>Размер текста: {Math.round(p.text_scale * 100)}%</Label>
          <Slider min={85} max={130} step={5} value={[Math.round(p.text_scale * 100)]} onValueChange={([v]) => set({ text_scale: v / 100 })} /></div>
        <div className="flex items-center justify-between"><Label>Меньше анимаций</Label><Switch checked={p.reduce_motion} onCheckedChange={(v) => set({ reduce_motion: v })} /></div>
        <div className="space-y-2"><Label>Язык</Label><div className="flex gap-2">{(["ru", "en", "uz"] as const).map((l) => <Button key={l} size="sm" variant={p.language === l ? "default" : "outline"} onClick={() => set({ language: l })}>{l.toUpperCase()}</Button>)}</div>
          <p className="text-xs text-muted-foreground">Выбор языка сохраняется в аккаунте, но интерфейс пока переведён только на русский.</p></div>
        <div className="flex items-center justify-between"><Label>Enter отправляет сообщение</Label><Switch checked={p.enter_sends} onCheckedChange={(v) => set({ enter_sends: v })} /></div>
      </section>
    </Page>
  );
}
