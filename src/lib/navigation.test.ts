import { describe, expect, it } from "vitest";
import { activeSectionFor, canAdd, canRemove, DEFAULT_NAV, normalizeNav } from "./navigation";

describe("navigation config rules", () => {
  it("default tabs are chats, contacts, calls, settings, profile", () => {
    expect(DEFAULT_NAV).toEqual(["chats", "contacts", "calls", "settings", "profile"]);
  });
  it("never allows more than five tabs", () => {
    expect(normalizeNav(["chats", "contacts", "calls", "channels", "groups", "settings", "profile"])).toHaveLength(5);
    expect(canAdd(["chats", "contacts", "calls", "settings", "profile"], "groups")).toBe(false);
  });
  it("always keeps settings, even if stored config lost it", () => {
    expect(normalizeNav(["chats"])).toContain("settings");
    expect(normalizeNav(["chats", "contacts", "calls", "channels", "groups"])).toContain("settings");
    expect(canRemove(["chats", "settings"], "settings")).toBe(false);
  });
  it("cannot remove the last tab and falls back to defaults on garbage", () => {
    expect(canRemove(["settings"], "settings")).toBe(false);
    expect(normalizeNav("bad")).toEqual(DEFAULT_NAV);
    expect(normalizeNav([])).toEqual(["settings"]);
  });
  it("detects the active tab from the URL", () => {
    expect(activeSectionFor("/settings/navigation", DEFAULT_NAV)).toBe("settings");
    expect(activeSectionFor("/chats", DEFAULT_NAV)).toBe("chats");
    expect(activeSectionFor("/groups", DEFAULT_NAV)).toBe(null);
  });
});
