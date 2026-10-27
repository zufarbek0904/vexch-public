export const USERNAME_RE = /^[a-z0-9_]{5,32}$/;

/** Returns an error text, or null when the username is valid. Mirrors the DB check. */
export function validateUsername(raw: string): string | null {
  const u = raw.toLowerCase();
  if (u.length < 5) return "Username должен быть не короче 5 символов";
  if (u.length > 32) return "Username должен быть не длиннее 32 символов";
  if (!USERNAME_RE.test(u)) return "Только латиница, цифры и «_»";
  return null;
}

export function authErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "";
  if (/Invalid login credentials/i.test(msg)) return "Неверный email или пароль";
  if (/Email not confirmed/i.test(msg)) return "Сначала подтвердите email по ссылке из письма";
  if (/rate limit|too many/i.test(msg)) return "Слишком много попыток. Подождите немного";
  if (/already registered/i.test(msg)) return "Этот email уже зарегистрирован";
  if (/Password should be|weak|pwned/i.test(msg)) return "Пароль слишком простой — выберите другой";
  if (/duplicate key|profiles_username_unique/i.test(msg)) return "Этот username уже занят";
  if (/username_format/i.test(msg)) return "Неверный формат username";
  return msg || "Что-то пошло не так. Попробуйте ещё раз";
}
