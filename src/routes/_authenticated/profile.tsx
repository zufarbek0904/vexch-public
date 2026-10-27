import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Camera, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Page } from "@/components/Page";
import { AvatarCropper } from "@/components/AvatarCropper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authErrorText, validateUsername } from "@/lib/account";
import { deleteMyAccount } from "@/lib/account.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Профиль — VexChat" },
      { name: "description", content: "Ваш профиль VexChat." },
      { property: "og:title", content: "Профиль — VexChat" },
      { property: "og:description", content: "Профиль пользователя VexChat." },
    ],
  }),
  component: ProfilePage,
});

function useMyProfile() {
  const { user } = Route.useRouteContext();
  return useQuery({
    queryKey: ["profile", user.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (error) throw error;
      let avatarSigned: string | null = null;
      if (data.avatar_url) {
        const s = await supabase.storage.from("avatars").createSignedUrl(data.avatar_url, 3600);
        avatarSigned = s.data?.signedUrl ?? null;
      }
      return { ...data, avatarSigned };
    },
  });
}

function ProfilePage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: p, isLoading, error } = useMyProfile();
  const [form, setForm] = useState({ username: "", display_name: "", bio: "", status_text: "" });
  const [saving, setSaving] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [delOpen, setDelOpen] = useState(false);
  const [delConfirm, setDelConfirm] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const del = useServerFn(deleteMyAccount);

  useEffect(() => {
    if (p) setForm({ username: p.username, display_name: p.display_name, bio: p.bio, status_text: p.status_text });
  }, [p]);

  if (isLoading) return <Page title="Профиль"><p className="text-muted-foreground">Загрузка…</p></Page>;
  if (error || !p) return <Page title="Профиль"><p className="text-destructive">Не удалось загрузить профиль</p></Page>;

  async function save() {
    const uErr = validateUsername(form.username);
    if (uErr) { toast.error(uErr); return; }
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ ...form, username: form.username.toLowerCase() }).eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(authErrorText(error)); return; }
    toast.success("Профиль сохранён");
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  }

  async function uploadAvatar(blob: Blob) {
    setCropFile(null);
    const path = `${user.id}/${Date.now()}.jpg`;
    const up = await supabase.storage.from("avatars").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) { toast.error("Не удалось загрузить аватар"); return; }
    const old = p?.avatar_url;
    const { error } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
    if (error) { toast.error("Не удалось сохранить аватар"); return; }
    if (old) await supabase.storage.from("avatars").remove([old]);
    toast.success("Аватар обновлён");
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function deleteAccount() {
    try {
      await del({ data: { confirmUsername: delConfirm } });
      qc.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } catch (e) {
      toast.error(authErrorText(e));
    }
  }

  const initial = (p.display_name || p.username).charAt(0).toUpperCase();

  return (
    <Page title="Профиль">
      <section className="glass mb-4 flex flex-col items-center rounded-3xl p-6 text-center">
        <button onClick={() => fileRef.current?.click()} className="group relative mb-3 size-24 overflow-hidden rounded-full bg-gradient-primary" aria-label="Сменить аватар">
          {p.avatarSigned ? <img src={p.avatarSigned} alt="" className="size-full object-cover" /> : <span className="text-3xl font-bold text-primary-foreground">{initial}</span>}
          <span className="absolute inset-x-0 bottom-0 flex justify-center bg-background/70 py-1"><Camera className="size-4" /></span>
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 10 * 1024 * 1024) { toast.error("Файл больше 10 МБ"); return; }
          setCropFile(f);
        }} />
        <h2 className="text-xl font-semibold">{p.display_name || p.username}</h2>
        <p className="text-sm text-primary">@{p.username}</p>
        <p className="mt-1 text-xs text-muted-foreground">В VexChat с {new Date(p.created_at).toLocaleDateString("ru-RU")}</p>
      </section>

      <section className="glass mb-4 space-y-4 rounded-3xl p-5">
        <div className="space-y-1.5"><Label htmlFor="dn">Имя</Label>
          <Input id="dn" maxLength={64} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="un">Username</Label>
          <Input id="un" maxLength={32} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} /></div>
        <div className="space-y-1.5"><Label htmlFor="st">Статус</Label>
          <Input id="st" maxLength={80} value={form.status_text} onChange={(e) => setForm({ ...form, status_text: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="bio">О себе</Label>
          <Textarea id="bio" maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
        <Button onClick={save} disabled={saving} className="w-full bg-gradient-primary text-primary-foreground">{saving ? "Сохранение…" : "Сохранить"}</Button>
      </section>

      <section className="glass space-y-2 rounded-3xl p-3">
        <Button variant="ghost" className="w-full justify-start" onClick={signOut}><LogOut className="size-4" /> Выйти</Button>
        <Button variant="ghost" className="w-full justify-start text-destructive" onClick={() => setDelOpen(true)}><Trash2 className="size-4" /> Удалить аккаунт</Button>
      </section>

      <Dialog open={!!cropFile} onOpenChange={(o) => !o && setCropFile(null)}>
        <DialogContent><DialogHeader><DialogTitle>Обрезка аватара</DialogTitle></DialogHeader>
          {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={uploadAvatar} />}
        </DialogContent>
      </Dialog>

      <Dialog open={delOpen} onOpenChange={setDelOpen}>
        <DialogContent><DialogHeader><DialogTitle>Удалить аккаунт навсегда?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Профиль, аватар и настройки будут удалены. Это нельзя отменить. Введите свой username <b>{p.username}</b> для подтверждения.</p>
          <Input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} />
          <Button variant="destructive" disabled={delConfirm.toLowerCase() !== p.username} onClick={deleteAccount}>Удалить</Button>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
