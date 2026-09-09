import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Telegram Mini App `initData` haqiqiyligini tekshiradi.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Imzo bot tokeni bilan hisoblanadi, shuning uchun ma'lumotni faqat
 * Telegram yaratgan bo'lishi mumkin — foydalanuvchi ID'siga ishonish mumkin.
 */

/** initData qancha vaqt haqiqiy hisoblanadi. */
const MAX_AGE_SECONDS = 24 * 60 * 60;

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface VerifiedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  queryId?: string;
}

export type VerifyResult =
  | { ok: true; data: VerifiedInitData }
  | { ok: false; reason: string };

/** `HMAC_SHA256(bot_token, key="WebAppData")` — Telegram belgilagan tartib. */
const secretKey = crypto
  .createHmac("sha256", "WebAppData")
  .update(config.telegramBotToken)
  .digest();

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function verifyInitData(initData: string): VerifyResult {
  if (!initData) return { ok: false, reason: "initData bo'sh" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: "initData o'qilmadi" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "hash yo'q" };

  // `hash` va `signature` imzo hisobiga kirmaydi.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const computed = crypto
    .createHmac("sha256", secretKey)
    .update(pairs.join("\n"))
    .digest("hex");

  if (!timingSafeEqualHex(computed, hash)) {
    return { ok: false, reason: "imzo mos kelmadi" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    return { ok: false, reason: "auth_date noto'g'ri" };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) {
    return { ok: false, reason: "initData muddati o'tgan" };
  }

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false, reason: "user ma'lumoti yo'q" };

  let user: TelegramWebAppUser;
  try {
    user = JSON.parse(rawUser) as TelegramWebAppUser;
  } catch {
    return { ok: false, reason: "user JSON buzuq" };
  }

  if (!Number.isSafeInteger(user.id)) {
    return { ok: false, reason: "user.id noto'g'ri" };
  }

  const queryId = params.get("query_id");
  return {
    ok: true,
    data: {
      user,
      authDate,
      ...(queryId ? { queryId } : {}),
    },
  };
}

/**
 * So'rov sarlavhalaridan initData'ni ajratib oladi.
 * `Authorization: tma <initData>` — Telegram Mini Apps uchun keng qabul qilingan shakl.
 */
export function extractInitData(headers: Record<string, unknown>): string | null {
  const direct = headers["x-telegram-init-data"];
  if (typeof direct === "string" && direct) return direct;

  const authorization = headers["authorization"];
  if (typeof authorization === "string") {
    const match = /^tma\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) return match[1];
  }

  return null;
}
