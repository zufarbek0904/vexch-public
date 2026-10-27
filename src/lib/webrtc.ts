import { supabase } from "@/integrations/supabase/client";
import { table, rpc } from "@/lib/db";

export type CallRow = { id: string; conversation_id: string; caller_id: string; callee_id: string; media: "audio" | "video"; status: string; started_at: string; connected_at: string | null; ended_at: string | null };
export type Signal = { id: number; call_id: string; from_user: string; to_user: string; kind: "offer" | "answer" | "ice" | "hangup"; payload: Record<string, unknown> };

export const sendSignal = async (call: CallRow, from: string, kind: Signal["kind"], payload: Record<string, unknown> = {}) => {
  const to = call.caller_id === from ? call.callee_id : call.caller_id;
  const { error } = await table("call_signals").insert({ call_id: call.id, from_user: from, to_user: to, kind, payload });
  if (error) throw new Error(error.message);
};
export const setCallStatus = async (id: string, status: string) => {
  const { error } = await table("calls").update({ status }).eq("id", id);
  return error?.message ?? null;
};
export const startCallRpc = (conversationId: string, media: "audio" | "video") => rpc<string>("start_call", { _conv: conversationId, _media: media });
export const currentUserId = async () => (await supabase.auth.getUser()).data.user?.id ?? null;
