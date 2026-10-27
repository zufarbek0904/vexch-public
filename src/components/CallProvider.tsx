import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { table } from "@/lib/db";
import { friendlyError, formatDuration } from "@/lib/chat-utils";
import { getIceServers } from "@/lib/server.functions";
import { sendSignal, setCallStatus, startCallRpc, type CallRow, type Signal } from "@/lib/webrtc";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "ringing-in" | "ringing-out" | "connecting" | "connected" | "ended";
type Ctx = { startCall: (conversationId: string, media: "audio" | "video") => Promise<void>; active: boolean };
const CallCtx = createContext<Ctx>({ startCall: async () => {}, active: false });
export const useCall = () => useContext(CallCtx);

/** Звонки 1-на-1 (WebRTC). «Соединено» показывается только когда RTCPeerConnection реально перешёл в connected. */
export function CallProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const iceFn = useServerFn(getIceServers);
  const [call, setCall] = useState<CallRow | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [peer, setPeer] = useState<{ name: string; avatar: string | null }>({ name: "", avatar: null });
  const [note, setNote] = useState("");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [secs, setSecs] = useState(0);
  const [hasTurn, setHasTurn] = useState(true);
  const callRef = useRef<CallRow | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const pc = useRef<RTCPeerConnection | null>(null);
  const local = useRef<MediaStream | null>(null);
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const timers = useRef<number[]>([]);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const cleanup = useCallback((message: string) => {
    timers.current.forEach(clearTimeout); timers.current = [];
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null;
    pc.current?.close(); pc.current = null;
    pendingOffer.current = null; pendingIce.current = [];
    setNote(message); go("ended"); setSecs(0); setMuted(false); setCamOff(false);
    window.setTimeout(() => { if (phaseRef.current === "ended") { callRef.current = null; setCall(null); go("idle"); } }, 2500);
  }, []);

  const loadPeer = async (c: CallRow) => {
    const id = c.caller_id === userId ? c.callee_id : c.caller_id;
    const { data } = await table("profiles").select("display_name, username, avatar_url").eq("id", id).maybeSingle();
    setPeer({ name: data?.display_name || data?.username || "Собеседник", avatar: data?.avatar_url ?? null });
  };

  const buildPc = async (c: CallRow) => {
    const { iceServers, hasTurn: t } = await iceFn();
    setHasTurn(t);
    const p = new RTCPeerConnection({ iceServers });
    p.onicecandidate = (e) => { if (e.candidate) sendSignal(c, userId, "ice", e.candidate.toJSON() as Record<string, unknown>).catch(() => {}); };
    p.ontrack = (e) => {
      const [s] = e.streams;
      if (remoteVideo.current) remoteVideo.current.srcObject = s;
      if (remoteAudio.current) remoteAudio.current.srcObject = s;
    };
    p.onconnectionstatechange = async () => {
      if (p.connectionState === "connected") { go("connected"); setNote(""); setCallStatus(c.id, "connected"); }
      if (p.connectionState === "disconnected") { setNote("Связь потеряна, пробуем восстановить…"); later(() => { if (pc.current === p && p.connectionState !== "connected") fail(c, "Соединение прервано"); }, 10000); }
      if (p.connectionState === "failed") fail(c, "Не удалось установить соединение");
    };
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: c.media === "video" });
    local.current = stream;
    stream.getTracks().forEach((tr) => p.addTrack(tr, stream));
    if (localVideo.current) localVideo.current.srcObject = stream;
    pc.current = p;
    return p;
  };

  const fail = async (c: CallRow, message: string) => {
    await setCallStatus(c.id, "failed");
    cleanup(message);
  };

  const flushIce = async () => {
    for (const cand of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(cand).catch(() => {});
  };

  const onSignal = async (s: Signal) => {
    const c = callRef.current;
    if (!c || s.call_id !== c.id) return;
    try {
      if (s.kind === "offer") {
        pendingOffer.current = s.payload as unknown as RTCSessionDescriptionInit;
      } else if (s.kind === "answer" && pc.current) {
        await pc.current.setRemoteDescription(s.payload as unknown as RTCSessionDescriptionInit);
        await flushIce();
      } else if (s.kind === "ice") {
        if (pc.current?.remoteDescription) await pc.current.addIceCandidate(s.payload as RTCIceCandidateInit).catch(() => {});
        else pendingIce.current.push(s.payload as RTCIceCandidateInit);
      } else if (s.kind === "hangup") {
        cleanup("Собеседник завершил звонок");
      }
    } catch { /* повреждённый сигнал игнорируем */ }
  };

  const startCall = async (conversationId: string, media: "audio" | "video") => {
    if (phaseRef.current !== "idle") { toast.error("Вы уже в звонке"); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") { toast.error("Браузер не поддерживает звонки"); return; }
    try {
      const id = await startCallRpc(conversationId, media);
      const { data } = await table("calls").select("*").eq("id", id).single();
      const c = data as CallRow;
      callRef.current = c; setCall(c); setNote(""); go("ringing-out"); loadPeer(c);
      const p = await buildPc(c);
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      await sendSignal(c, userId, "offer", { type: offer.type, sdp: offer.sdp });
      later(() => { if (phaseRef.current === "ringing-out") { setCallStatus(c.id, "missed"); cleanup("Нет ответа"); } }, 45000);
    } catch (e) {
      const c = callRef.current;
      if (c) await setCallStatus(c.id, "failed");
      cleanup(e instanceof DOMException ? "Нет доступа к камере или микрофону" : friendlyError((e as Error).message));
    }
  };

  const accept = async () => {
    const c = callRef.current;
    if (!c) return;
    go("connecting");
    try {
      const p = await buildPc(c);
      // оффер мог ещё не прийти по realtime — дочитываем из таблицы
      if (!pendingOffer.current) {
        const { data } = await table("call_signals").select("*").eq("call_id", c.id).eq("kind", "offer").order("id", { ascending: false }).limit(1);
        if (data?.[0]) pendingOffer.current = data[0].payload;
      }
      if (!pendingOffer.current) throw new Error("Не получено предложение звонка");
      await p.setRemoteDescription(pendingOffer.current);
      await flushIce();
      const ans = await p.createAnswer();
      await p.setLocalDescription(ans);
      await sendSignal(c, userId, "answer", { type: ans.type, sdp: ans.sdp });
      const { data: ices } = await table("call_signals").select("*").eq("call_id", c.id).eq("kind", "ice");
      for (const r of ices ?? []) await onSignal(r as Signal);
    } catch (e) {
      await setCallStatus(c.id, "failed");
      cleanup(e instanceof DOMException ? "Нет доступа к камере или микрофону" : "Не удалось принять звонок");
    }
  };

  const decline = async () => { const c = callRef.current; if (c) await setCallStatus(c.id, "declined"); cleanup("Звонок отклонён"); };
  const hangup = async () => {
    const c = callRef.current;
    if (c) { await sendSignal(c, userId, "hangup").catch(() => {}); await setCallStatus(c.id, "ended"); }
    cleanup("Звонок завершён");
  };

  useEffect(() => {
    const ch = supabase.channel(`calls:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_signals", filter: `to_user=eq.${userId}` }, (p) => onSignal(p.new as Signal))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls" }, (p) => {
        const c = p.new as CallRow;
        if (c.callee_id !== userId || c.status !== "ringing" || phaseRef.current !== "idle") return;
        callRef.current = c; setCall(c); setNote(""); go("ringing-in"); loadPeer(c);
        later(() => { if (phaseRef.current === "ringing-in") cleanup("Пропущенный звонок"); }, 60000);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls" }, (p) => {
        const c = p.new as CallRow;
        if (c.id !== callRef.current?.id) return;
        if (["ended", "missed", "declined", "failed"].includes(c.status) && phaseRef.current !== "ended" && phaseRef.current !== "idle") {
          cleanup(c.status === "declined" ? "Собеседник отклонил звонок" : c.status === "missed" ? "Пропущенный звонок" : c.status === "failed" ? "Звонок не удался" : "Звонок завершён");
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (phase !== "connected") return;
    const t0 = Date.now();
    const i = window.setInterval(() => setSecs((Date.now() - t0) / 1000), 1000);
    return () => clearInterval(i);
  }, [phase]);

  const toggleMic = () => { local.current?.getAudioTracks().forEach((t) => (t.enabled = muted)); setMuted(!muted); };
  const toggleCam = () => { local.current?.getVideoTracks().forEach((t) => (t.enabled = camOff)); setCamOff(!camOff); };
  const label = { "ringing-in": "Входящий звонок", "ringing-out": "Вызываем…", connecting: "Соединяем…", connected: formatDuration(secs), ended: note || "Завершён", idle: "" }[phase];

  return (
    <CallCtx.Provider value={{ startCall, active: phase !== "idle" }}>
      {children}
      {phase !== "idle" && call && (
        <div role="dialog" aria-label="Звонок" className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-background/95 p-6 pt-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <audio ref={remoteAudio} autoPlay />
          {call.media === "video" && <video ref={remoteVideo} autoPlay playsInline className="absolute inset-0 -z-10 size-full object-cover" />}
          {call.media === "video" && <video ref={localVideo} autoPlay playsInline muted className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] h-36 w-24 rounded-2xl border border-glass-border object-cover" />}
          <div className="flex flex-col items-center gap-3 text-center">
            <UserAvatar path={peer.avatar} name={peer.name} className="size-28 text-4xl" />
            <h2 className="text-2xl font-semibold">{peer.name}</h2>
            <p className="text-muted-foreground">{label}</p>
            {note && phase !== "ended" && <p className="text-sm text-warning">{note}</p>}
            {!hasTurn && phase !== "ringing-in" && <p className="max-w-xs text-xs text-muted-foreground">TURN-сервер не настроен: между разными сетями звонок может не соединиться.</p>}
          </div>
          <div className="flex items-center gap-4">
            {phase === "ringing-in" ? (
              <>
                <Button size="icon" variant="destructive" className="size-16 rounded-full" onClick={decline} aria-label="Отклонить"><PhoneOff className="!size-7" /></Button>
                <Button size="icon" className="size-16 rounded-full bg-success text-background" onClick={accept} aria-label="Принять"><Phone className="!size-7" /></Button>
              </>
            ) : phase !== "ended" && (
              <>
                <Button size="icon" variant="secondary" className="size-14 rounded-full" onClick={toggleMic} aria-label="Микрофон">{muted ? <MicOff /> : <Mic />}</Button>
                {call.media === "video" && <Button size="icon" variant="secondary" className="size-14 rounded-full" onClick={toggleCam} aria-label="Камера">{camOff ? <VideoOff /> : <Video />}</Button>}
                <Button size="icon" variant="destructive" className="size-16 rounded-full" onClick={hangup} aria-label="Завершить"><PhoneOff className="!size-7" /></Button>
              </>
            )}
          </div>
        </div>
      )}
    </CallCtx.Provider>
  );
}
