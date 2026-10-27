import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Permanently deletes the signed-in user's own account. Requires typing the username. */
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { confirmUsername: string }) => {
    if (typeof input?.confirmUsername !== "string") throw new Error("bad input");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: profile } = await context.supabase.from("profiles").select("username").eq("id", context.userId).single();
    if (!profile || profile.username.toLowerCase() !== data.confirmUsername.trim().toLowerCase()) {
      throw new Error("Username не совпадает");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("admin_audit_logs").insert({
      actor_id: context.userId,
      action: "account.self_delete",
      target_type: "user",
      target_id: context.userId,
    });
    const files = await supabaseAdmin.storage.from("avatars").list(context.userId);
    if (files.data?.length) {
      await supabaseAdmin.storage.from("avatars").remove(files.data.map((f) => `${context.userId}/${f.name}`));
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error("Не удалось удалить аккаунт");
    // Rows keyed by user_id without FKs (prefs, contacts, blocks) are cleaned here.
    await Promise.all([
      supabaseAdmin.from("user_preferences").delete().eq("user_id", context.userId),
      supabaseAdmin.from("contacts").delete().eq("owner_id", context.userId),
      supabaseAdmin.from("blocks").delete().eq("blocker_id", context.userId),
      supabaseAdmin.from("conversation_members").delete().eq("user_id", context.userId),
    ]);
    return { ok: true };
  });
