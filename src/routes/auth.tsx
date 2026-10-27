import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateUsername, authErrorText } from "@/lib/account";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход — VexChat" },
      { name: "description", content: "Войдите или создайте аккаунт VexChat." },
      { property: "og:title", content: "Вход — VexChat" },
      { property: "og:description", content: "Вход и регистрация в VexChat." },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chats", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/chats", replace: true });
      } else if (mode === "signup") {
        const uErr = validateUsername(username);
        if (uErr) throw new Error(uErr);
        const { data: taken } = await supabase.rpc("username_available", { _username: username });
        if (taken === false) throw new Error("Этот username уже занят");
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin, data: { username: username.toLowerCase() } },
        });
        if (error) throw error;
        setSent("Мы отправили письмо для подтверждения. Откройте ссылку из письма, затем войдите.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSent("Если аккаунт с этим адресом существует, письмо для сброса пароля уже отправлено.");
      }
    } catch (err) {
      toast.error(authErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error("Не удалось войти через Google");
    else if (!r.redirected) navigate({ to: "/chats", replace: true });
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="glass w-full max-w-sm rounded-3xl p-6">
        <h1 className="text-3xl font-bold">
          <span className="text-gradient">VexChat</span>
        </h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          {mode === "signin" ? "Вход в аккаунт" : mode === "signup" ? "Новый аккаунт" : "Восстановление пароля"}
        </p>

        {sent ? (
          <div className="space-y-4">
            <p className="text-sm">{sent}</p>
            <Button variant="secondary" className="w-full" onClick={() => { setSent(null); setMode("signin"); }}>
              Ко входу
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value.trim())} placeholder="например, alex_vex" autoComplete="username" required />
                <p className="text-xs text-muted-foreground">5–32 символа: латиница, цифры, «_»</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <Label htmlFor="password">Пароль</Label>
                <Input id="password" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
              </div>
            )}
            <Button type="submit" disabled={busy} className="w-full bg-gradient-primary text-primary-foreground shadow-glow">
              {busy ? "Подождите…" : mode === "signin" ? "Войти" : mode === "signup" ? "Создать аккаунт" : "Отправить ссылку"}
            </Button>
          </form>
        )}

        {!sent && mode !== "forgot" && (
          <>
            <div className="my-4 text-center text-xs text-muted-foreground">или</div>
            <Button variant="secondary" className="w-full" onClick={google}>Продолжить с Google</Button>
          </>
        )}

        {!sent && (
          <div className="mt-5 flex flex-col gap-2 text-center text-sm">
            {mode === "signin" && (
              <>
                <button className="text-primary" onClick={() => setMode("signup")}>Создать аккаунт</button>
                <button className="text-muted-foreground" onClick={() => setMode("forgot")}>Забыли пароль?</button>
              </>
            )}
            {mode !== "signin" && <button className="text-primary" onClick={() => setMode("signin")}>У меня есть аккаунт</button>}
          </div>
        )}
      </div>
    </main>
  );
}
