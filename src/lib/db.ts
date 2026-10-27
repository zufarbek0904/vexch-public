import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/chat-utils";

// Таблицы и RPC из миграции 0003 появятся в types.ts после перегенерации типов в Lovable.
// До тех пор обращаемся к ним через эти обёртки (без потери проверки ошибок).
/* eslint-disable @typescript-eslint/no-explicit-any */
const raw = supabase as any;

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await raw.rpc(fn, args ?? {});
  if (error) throw new Error(friendlyError(error.message));
  return data as T;
}
export const table = (name: string) => raw.from(name);
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(friendlyError(res.error.message));
  return res.data as T;
}

export type Kind = "direct" | "group" | "channel" | "saved";
export type ConvRow = {
  conversation_id: string; kind: Kind; title: string | null; avatar_url: string | null; is_public: boolean;
  other_user_id: string | null; other_username: string | null; other_display_name: string | null; other_avatar_url: string | null;
  last_body: string | null; last_sender_id: string | null; last_at: string | null; last_deleted: boolean; unread_count: number;
  muted: boolean; archived: boolean; pinned: boolean; draft: string | null; my_role: "owner" | "admin" | "member";
  ttl_seconds: number | null; is_restricted: boolean;
};
export type Msg = {
  id: string; conversation_id: string; sender_id: string; client_id: string; body: string | null; reply_to_id: string | null;
  forwarded_from_id: string | null; is_pinned: boolean; edited_at: string | null; deleted_at: string | null; expires_at: string | null;
  scheduled_for: string | null; created_at: string; mentions: string[]; thread_root_id: string | null;
  _status?: "sending" | "failed";
};
export type PublicProfile = { id: string; username: string; display_name: string; avatar_url: string | null; bio?: string };

export const convTitle = (c: ConvRow) =>
  c.kind === "direct" ? c.other_display_name || c.other_username || "Удалённый аккаунт" : c.kind === "saved" ? "Избранное" : c.title || "Без названия";

export async function signedUrl(bucket: string, path: string | null | undefined, ttl = 3600): Promise<string | null> {
  if (!path) return null;
  const r = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  return r.data?.signedUrl ?? null;
}
