import { supabase } from "@/integrations/supabase/client";
import { normalizeNav, saveNav, type NavSectionId } from "@/lib/navigation";

/** Pull the account's saved tabs into this device. */
export async function pullNav() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  const { data } = await supabase.from("user_preferences").select("nav_tabs").eq("user_id", u.user.id).maybeSingle();
  if (data?.nav_tabs) saveNav(normalizeNav(data.nav_tabs));
}

/** Save to the account first (server validates), then to this device. */
export async function pushNav(list: NavSectionId[]) {
  const clean = normalizeNav(list);
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Нужно войти в аккаунт");
  const { error } = await supabase.from("user_preferences").upsert({ user_id: u.user.id, nav_tabs: clean });
  if (error) throw error;
  saveNav(clean);
}
