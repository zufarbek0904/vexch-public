import { describe, expect, it } from "vitest";
import { buildCsv, formatDuration, friendlyError, kindFromMime, parseMentions, receiptStatus, safeFileName, ttlLabel } from "./chat-utils";

describe("chat-utils", () => {
  it("parses only real member mentions", () => {
    const members = [{ user_id: "1", username: "alice_01" }, { user_id: "2", username: "bob_user" }];
    expect(parseMentions("hi @alice_01 and @ghost_user and @ALICE_01", members)).toEqual(["1"]);
  });
  it("computes receipt status from real receipts", () => {
    expect(receiptStatus([])).toBe("sent");
    expect(receiptStatus([{ delivered_at: "x", read_at: null }])).toBe("delivered");
    expect(receiptStatus([{ delivered_at: "x", read_at: null }, { delivered_at: "x", read_at: "y" }])).toBe("read");
  });
  it("maps technical errors to Russian text", () => {
    expect(friendlyError("rate_limited: too many messages")).toContain("Слишком часто");
    expect(friendlyError("new row violates row-level security policy")).toContain("прав");
    expect(friendlyError("")).toContain("Что-то пошло не так");
  });
  it("neutralizes CSV formula injection and escapes quotes", () => {
    const csv = buildCsv([{ a: "=SUM(A1)", b: 'say "hi", ok' }]);
    expect(csv).toBe(`a,b\n'=SUM(A1),"say ""hi"", ok"`);
  });
  it("formats durations and ttl", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(ttlLabel(null)).toBe("Выключено");
    expect(ttlLabel(3600)).toBe("1 ч");
  });
  it("sanitizes file names and detects kinds", () => {
    expect(safeFileName("мой файл (1).PDF")).toMatch(/^[\w.\-]+$/);
    expect(kindFromMime("audio/webm")).toBe("voice");
    expect(kindFromMime("application/pdf")).toBe("document");
  });
});
