import {
  MessageCircle,
  Users,
  Phone,
  Radio,
  UsersRound,
  Settings,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

export type NavSectionId =
  | "chats"
  | "contacts"
  | "calls"
  | "channels"
  | "groups"
  | "settings"
  | "profile";

export type NavSection = {
  id: NavSectionId;
  label: string;
  path: "/chats" | "/contacts" | "/calls" | "/channels" | "/groups" | "/settings" | "/profile";
  icon: LucideIcon;
  /** Required sections can never be removed (keeps access to settings). */
  required?: boolean;
};

export const NAV_SECTIONS: Record<NavSectionId, NavSection> = {
  chats: { id: "chats", label: "Чаты", path: "/chats", icon: MessageCircle },
  contacts: { id: "contacts", label: "Контакты", path: "/contacts", icon: Users },
  calls: { id: "calls", label: "Звонки", path: "/calls", icon: Phone },
  channels: { id: "channels", label: "Каналы", path: "/channels", icon: Radio },
  groups: { id: "groups", label: "Группы", path: "/groups", icon: UsersRound },
  settings: { id: "settings", label: "Настройки", path: "/settings", icon: Settings, required: true },
  profile: { id: "profile", label: "Профиль", path: "/profile", icon: UserCircle },
};

export const ALL_SECTION_IDS = Object.keys(NAV_SECTIONS) as NavSectionId[];
export const MAX_TABS = 5;
export const DEFAULT_NAV: NavSectionId[] = ["chats", "contacts", "calls", "settings", "profile"];

/**
 * Normalizes any (possibly corrupted) stored config into a valid one:
 * known ids only, no duplicates, at most MAX_TABS, settings always present.
 */
export function normalizeNav(input: unknown): NavSectionId[] {
  if (!Array.isArray(input)) return [...DEFAULT_NAV];
  const seen = new Set<NavSectionId>();
  for (const v of input) {
    if (typeof v === "string" && (ALL_SECTION_IDS as string[]).includes(v)) {
      seen.add(v as NavSectionId);
    }
  }
  let list = [...seen].slice(0, MAX_TABS);
  if (!list.includes("settings")) {
    list = [...list.slice(0, MAX_TABS - 1), "settings"];
  }
  return list;
}

export function canRemove(list: NavSectionId[], id: NavSectionId): boolean {
  return !NAV_SECTIONS[id].required && list.includes(id) && list.length > 1;
}

export function canAdd(list: NavSectionId[], id: NavSectionId): boolean {
  return !list.includes(id) && list.length < MAX_TABS;
}

export function activeSectionFor(pathname: string, list: NavSectionId[]): NavSectionId | null {
  for (const id of list) {
    const p = NAV_SECTIONS[id].path;
    if (pathname === p || pathname.startsWith(p + "/")) return id;
  }
  return null;
}

// ---- Persistence (stage 1: this device only; moves to the account in stage 2) ----

const KEY = "vexchat.nav.v1";
const listeners = new Set<() => void>();

export function loadNav(): NavSectionId[] {
  if (typeof window === "undefined") return [...DEFAULT_NAV];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? normalizeNav(JSON.parse(raw)) : [...DEFAULT_NAV];
  } catch {
    return [...DEFAULT_NAV];
  }
}

export function saveNav(list: NavSectionId[]) {
  const clean = normalizeNav(list);
  window.localStorage.setItem(KEY, JSON.stringify(clean));
  listeners.forEach((l) => l());
}

export function subscribeNav(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
