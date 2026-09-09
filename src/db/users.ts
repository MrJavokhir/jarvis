import { db } from "./index.js";
import { config } from "../config.js";
import { normalizeTimezone } from "../lib/time.js";

export interface UserRow {
  telegram_id: number;
  first_name: string | null;
  username: string | null;
  language_code: string | null;
  timezone: string;
  created_at: number;
  updated_at: number;
}

export interface UpsertUserInput {
  telegramId: number;
  firstName?: string | null;
  username?: string | null;
  languageCode?: string | null;
}

const selectUser = db.prepare<[number], UserRow>(
  `SELECT * FROM users WHERE telegram_id = ?`,
);

const insertUser = db.prepare(
  `INSERT INTO users (telegram_id, first_name, username, language_code, timezone, created_at, updated_at)
   VALUES (@telegram_id, @first_name, @username, @language_code, @timezone, @now, @now)
   ON CONFLICT (telegram_id) DO UPDATE SET
     first_name    = excluded.first_name,
     username      = excluded.username,
     language_code = excluded.language_code,
     updated_at    = excluded.updated_at`,
);

const updateTimezone = db.prepare(
  `UPDATE users SET timezone = ?, updated_at = ? WHERE telegram_id = ?`,
);

export function getUser(telegramId: number): UserRow | undefined {
  return selectUser.get(telegramId);
}

/** Foydalanuvchini yaratadi yoki profil ma'lumotlarini yangilaydi. Mintaqa tegilmaydi. */
export function upsertUser(input: UpsertUserInput): UserRow {
  insertUser.run({
    telegram_id: input.telegramId,
    first_name: input.firstName ?? null,
    username: input.username ?? null,
    language_code: input.languageCode ?? null,
    timezone: config.defaultTimezone,
    now: Date.now(),
  });
  const user = selectUser.get(input.telegramId);
  if (!user) throw new Error(`Foydalanuvchi saqlanmadi: ${input.telegramId}`);
  return user;
}

export function setUserTimezone(telegramId: number, timezone: string): string {
  const normalized = normalizeTimezone(timezone, config.defaultTimezone);
  updateTimezone.run(normalized, Date.now(), telegramId);
  return normalized;
}

/** Foydalanuvchining mintaqasi; yozuv topilmasa standart mintaqa. */
export function userTimezone(telegramId: number): string {
  const user = selectUser.get(telegramId);
  return normalizeTimezone(user?.timezone, config.defaultTimezone);
}
