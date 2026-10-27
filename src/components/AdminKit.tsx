import type { ReactNode } from "react";
import { useAdminPerms } from "@/hooks/use-admin";

export function Need({ perm, children }: { perm: string; children: ReactNode }) {
  const { data, isLoading } = useAdminPerms();
  if (isLoading) return <p className="text-muted-foreground">Загрузка…</p>;
  if (!data?.perms.has(perm)) return <section className="glass rounded-3xl p-6 text-sm">Недостаточно прав для этого раздела.</section>;
  return <>{children}</>;
}
export const Card = ({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) => (
  <section className={`glass rounded-3xl p-4 ${className}`}>{title && <h2 className="mb-3 font-semibold">{title}</h2>}{children}</section>
);
export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="glass rounded-2xl p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p>{hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}</div>
);
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
