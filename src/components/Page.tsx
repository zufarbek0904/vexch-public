import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Page({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-safe-nav">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{title}</h1>
        {action}
      </header>
      {children}
    </main>
  );
}

/** Honest placeholder: says which stage brings the feature. */
export function StagePlaceholder({ icon: Icon, title, text, stage }: { icon: LucideIcon; title: string; text: string; stage: number }) {
  return (
    <section className="glass flex flex-col items-center rounded-3xl px-6 py-12 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gradient-primary shadow-glow">
        <Icon className="size-7 text-primary-foreground" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-xs text-sm text-muted-foreground">{text}</p>
      <span className="mt-5 rounded-full border border-glass-border px-3 py-1 text-xs text-muted-foreground">
        Появится на этапе {stage}
      </span>
    </section>
  );
}
