import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/db";

export type Prefs = {
  theme: "dark" | "light" | "system"; accent: string; text_scale: number; reduce_motion: boolean; sounds_enabled: boolean;
  language: "ru" | "en" | "uz"; notify_messages: boolean; notify_preview: boolean; notify_invites: boolean; notify_calls: boolean;
  who_can_message: "everyone" | "contacts"; read_receipts: boolean; enter_sends: boolean;
};
export const DEFAULT_PREFS: Prefs = {
  theme: "dark", accent: "cyan", text_scale: 1, reduce_motion: false, sounds_enabled: true, language: "ru", notify_messages: true,
  notify_preview: true, notify_invites: true, notify_calls: true, who_can_message: "everyone", read_receipts: true, enter_sends: true,
};
export const ACCENTS: Record<string, { label: string; primary: string; glow: string }> = {
  cyan: { label: "Бирюзовый", primary: "oklch(0.8 0.13 200)", glow: "oklch(0.74 0.15 165)" },
  violet: { label: "Фиолетовый", primary: "oklch(0.74 0.16 295)", glow: "oklch(0.7 0.18 330)" },
  emerald: { label: "Изумрудный", primary: "oklch(0.78 0.16 155)", glow: "oklch(0.8 0.14 190)" },
  rose: { label: "Розовый", primary: "oklch(0.74 0.17 10)", glow: "oklch(0.76 0.15 50)" },
  amber: { label: "Янтарный", primary: "oklch(0.82 0.15 80)", glow: "oklch(0.76 0.17 45)" },
};

export function usePreferences() {
  return useQuery({
    queryKey: ["prefs"],
    queryFn: async (): Promise<Prefs> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return DEFAULT_PREFS;
      const { data } = await table("user_preferences").select("*").eq("user_id", u.user.id).maybeSingle();
      return { ...DEFAULT_PREFS, ...(data ?? {}), text_scale: Number(data?.text_scale ?? 1) };
    },
  });
}

export function useSavePrefs() {
  const qc = useQueryClient();
  return async (patch: Partial<Prefs>) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new Error("Нужно войти");
    const { error } = await table("user_preferences").upsert({ user_id: u.user.id, ...patch });
    if (error) throw new Error(error.message);
    await qc.invalidateQueries({ queryKey: ["prefs"] });
  };
}

/** Применяет тему, акцент, размер текста и «меньше анимаций» к документу. */
export function useApplyPreferences() {
  const { data: p } = usePreferences();
  useEffect(() => {
    if (!p) return;
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = p.theme === "dark" || (p.theme === "system" && mq.matches);
      root.classList.toggle("dark", dark);
      root.classList.toggle("light", !dark);
      root.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    const a = ACCENTS[p.accent] ?? ACCENTS.cyan;
    root.style.setProperty("--primary", a.primary);
    root.style.setProperty("--primary-glow", a.glow);
    root.style.setProperty("--ring", `color-mix(in oklab, ${a.primary} 60%, transparent)`);
    root.style.fontSize = `${Math.round(p.text_scale * 100)}%`;
    root.dataset.reduceMotion = String(p.reduce_motion);
    root.lang = p.language;
    return () => mq.removeEventListener("change", apply);
  }, [p]);
}
