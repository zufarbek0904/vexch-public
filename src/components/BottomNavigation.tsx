import { Link, useLocation } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import { activeSectionFor, NAV_SECTIONS, type NavSectionId } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Props = {
  items: NavSectionId[];
  /** Preview mode: renders inline, not fixed, links disabled. */
  preview?: boolean;
  previewActive?: NavSectionId;
};

export function BottomNavigation({ items, preview, previewActive }: Props) {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();
  const active = preview ? (previewActive ?? items[0]) : activeSectionFor(pathname, items);
  const transition = reduce ? { duration: 0 } : { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <nav
      aria-label="Основная навигация"
      className={cn(
        "z-40 mx-auto flex w-[calc(100%-1.5rem)] max-w-md items-center justify-between gap-1 rounded-full p-1.5 glass-strong",
        preview ? "relative" : "fixed inset-x-0 bottom-safe",
      )}
    >
      {items.map((id) => {
        const s = NAV_SECTIONS[id];
        const Icon = s.icon;
        const isActive = active === id;
        const inner = (
          <motion.span
            layout={!reduce}
            transition={transition}
            className={cn(
              "relative flex h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold",
              isActive ? "text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {isActive && (
              <motion.span
                layoutId={preview ? "nav-pill-preview" : "nav-pill"}
                transition={transition}
                className="absolute inset-0 rounded-full bg-gradient-primary shadow-glow"
              />
            )}
            <Icon className="relative size-5 shrink-0" strokeWidth={2.2} />
            {isActive && (
              <motion.span
                initial={reduce ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transition}
                className="relative whitespace-nowrap"
              >
                {s.label}
              </motion.span>
            )}
          </motion.span>
        );
        return preview ? (
          <span key={id} className={cn(isActive ? "flex-[2]" : "flex-1", "flex justify-center")}>
            {inner}
          </span>
        ) : (
          <Link
            key={id}
            to={s.path}
            aria-label={s.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              isActive ? "flex-[2]" : "flex-1",
              "flex justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
