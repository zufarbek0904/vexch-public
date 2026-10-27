import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function logServerError(source: string, err: unknown) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as any).from("error_events").insert({ source, message: String((err as Error)?.message ?? err).slice(0, 500) });
  } catch { /* логирование не должно ломать запрос */ }
}

/** STUN всегда; TURN — только если заданы секреты TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL. Секреты не уходят в клиентский бандл. */
export const getIceServers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [{ urls: "stun:stun.l.google.com:19302" }];
    const urls = process.env["TURN_URLS"];
    const username = process.env["TURN_USERNAME"];
    const credential = process.env["TURN_CREDENTIAL"];
    const hasTurn = !!(urls && username && credential);
    if (hasTurn) iceServers.push({ urls: urls!.split(",").map((u) => u.trim()), username, credential });
    return { iceServers, hasTurn };
  });

/** Удаление аккаунта сотрудником: права, причина и аудит проверяются в БД (RPC), затем удаляется auth-пользователь. */
export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { userId: string; reason: string }) => {
    if (typeof i?.userId !== "string" || typeof i?.reason !== "string") throw new Error("bad input");
    return i;
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any).rpc("admin_prepare_account_deletion", { _user: data.userId, _reason: data.reason });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const files = await supabaseAdmin.storage.from("avatars").list(data.userId);
    if (files.data?.length) await supabaseAdmin.storage.from("avatars").remove(files.data.map((f) => `${data.userId}/${f.name}`));
    const res = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (res.error) { await logServerError("adminDeleteUser", res.error); throw new Error("Не удалось удалить аккаунт"); }
    return { ok: true };
  });

/** Реальные проверки инфраструктуры. Realtime проверяется в браузере. Секреты и строки подключения не возвращаются. */
export const serverHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const checks: { name: string; ok: boolean; ms: number; detail: string }[] = [];
    const run = async (name: string, fn: () => Promise<string>) => {
      const t = Date.now();
      try { const detail = await fn(); checks.push({ name, ok: true, ms: Date.now() - t, detail }); }
      catch (e) { await logServerError(`health:${name}`, e); checks.push({ name, ok: false, ms: Date.now() - t, detail: "ошибка проверки" }); }
    };
    // право health.view проверяется внутри RPC; без права она бросит ошибку
    let cron: unknown = null;
    await run("База данных", async () => {
      const { data, error } = await (context.supabase as any).rpc("health_ping");
      if (error) throw new Error(error.message);
      cron = data;
      return "запрос выполнен";
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await run("Хранилище (Storage)", async () => {
      const r = await supabaseAdmin.storage.listBuckets();
      if (r.error) throw r.error;
      return `бакетов: ${r.data.length}`;
    });
    await run("Авторизация (Auth)", async () => {
      const r = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (r.error) throw r.error;
      return "API отвечает";
    });
    const { count } = await (supabaseAdmin as any).from("error_events").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
    return { checkedAt: new Date().toISOString(), checks, errors24h: count ?? 0, cron, turnConfigured: !!process.env["TURN_URLS"] };
  });
