// Чистая логика без зависимостей от React и Supabase — её легко тестировать.

/** Переводит технические ошибки БД/сервера в понятный русский текст. */
export function friendlyError(raw: string): string {
  const m = (raw || "").toLowerCase();
  if (m.includes("rate_limited") || m.includes("too many")) return "Слишком часто. Подождите немного и повторите";
  if (m.includes("account_restricted")) return "Ваш аккаунт ограничен модерацией";
  if (m.includes("maintenance")) return "Идёт техническое обслуживание. Попробуйте позже";
  if (m.includes("registration_closed")) return "Регистрация сейчас закрыта";
  if (m.includes("forbidden") || m.includes("permission denied") || m.includes("row-level security")) return "Недостаточно прав для этого действия";
  if (m.includes("accepts messages from contacts only")) return "Пользователь принимает сообщения только от контактов";
  if (m.includes("blocked")) return "Действие недоступно: пользователь заблокирован";
  if (m.includes("busy")) return "Собеседник сейчас занят";
  if (m.includes("user unavailable")) return "Пользователь недоступен";
  if (m.includes("duplicate report")) return "Вы уже отправляли такую жалобу — она ещё рассматривается";
  if (m.includes("duplicate key") || m.includes("public_handle") || m.includes("conversations_handle_unique")) return "Такое имя уже занято";
  if (m.includes("appeal already filed")) return "Апелляция уже подана";
  if (m.includes("reason required")) return "Укажите причину (не короче 3 символов)";
  if (m.includes("confirmation required")) return "Нужно подтверждение опасного действия";
  if (m.includes("group is full")) return "Группа заполнена";
  if (m.includes("invite is not valid")) return "Ссылка-приглашение недействительна или отозвана";
  if (m.includes("transfer ownership")) return "Сначала передайте владение другому участнику";
  if (m.includes("file too large")) return "Файл слишком большой";
  if (m.includes("file type not allowed")) return "Этот тип файла не разрешён";
  if (m.includes("failed to fetch") || m.includes("network")) return "Нет соединения с сервером";
  return raw || "Что-то пошло не так. Попробуйте ещё раз";
}

/** Находит @username в тексте и возвращает id участников чата, которых упомянули. */
export function parseMentions(body: string, members: { user_id: string; username: string | null }[]): string[] {
  const found = new Set<string>();
  const re = /@([a-z0-9_]{5,32})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const name = m[1].toLowerCase();
    const hit = members.find((x) => x.username?.toLowerCase() === name);
    if (hit) found.add(hit.user_id);
  }
  return [...found];
}

export type SendStatus = "sending" | "failed" | "sent" | "delivered" | "read";

/** Статус считается по реальным записям message_receipts, а не по нажатию кнопки. */
export function receiptStatus(receipts: { delivered_at: string | null; read_at: string | null }[]): SendStatus {
  if (receipts.some((r) => r.read_at)) return "read";
  if (receipts.some((r) => r.delivered_at)) return "delivered";
  return "sent";
}

export function formatTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ttlLabel(seconds: number | null | undefined): string {
  if (!seconds) return "Выключено";
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} мин`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} ч`;
  return `${Math.round(seconds / 86400)} дн`;
}

export function initials(name: string | null | undefined): string {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}

export function safeFileName(name: string): string {
  const clean = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-80);
  return clean || "file";
}

export type AttachmentKind = "image" | "video" | "document" | "voice";
export function kindFromMime(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "voice";
  return "document";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} МБ`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

/** CSV с защитой от формул (=, +, -, @ в начале ячейки) и правильным экранированием. */
export function buildCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** Короткий текст последнего сообщения для списка чатов. */
export function previewText(row: { last_body: string | null; last_deleted: boolean; last_at: string | null }, hasAny: boolean): string {
  if (row.last_deleted) return "Сообщение удалено";
  if (row.last_body) return row.last_body;
  return hasAny ? "Вложение" : "Нет сообщений";
}
