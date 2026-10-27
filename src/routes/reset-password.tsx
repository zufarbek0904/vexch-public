import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorText } from "@/lib/account";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Новый пароль — VexChat" },
      { name: "description", content: "Задайте новый пароль для аккаунта VexChat." },
      { property: "og:title", content: "Новый пароль — VexChat" },
      { property: "og:description", content: "Сброс пароля VexChat." },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(authErrorText(error));
      return;
    }
    toast.success("Пароль обновлён");
    navigate({ to: "/chats", replace: true });
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 rounded-3xl p-6">
        <h1 className="text-2xl font-bold">Новый пароль</h1>
        <div className="space-y-1.5">
          <Label htmlFor="pw">Пароль (не меньше 8 символов)</Label>
          <Input id="pw" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <Button type="submit" disabled={busy} className="w-full bg-gradient-primary text-primary-foreground">Сохранить</Button>
      </form>
    </main>
  );
}
