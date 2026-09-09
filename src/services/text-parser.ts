import { DateTime } from "luxon";
import { UZ_MONTHS_GENITIVE, type Recurrence } from "../lib/time.js";
import type { ExtractedTask } from "./parser.js";

/**
 * Matnli xabarlarni AI'siz, qoidalar asosida o'qiydigan tahlilchi.
 *
 * Ovozli xabarlar til modeliga boradi (u yerda ifoda erkin bo'ladi), matn esa
 * shu yerda hal qilinadi: tez, bepul va natijasi oldindan aniq.
 *
 * Qo'llab-quvvatlanadigan shakllar:
 *   sana    — bugun / ertaga / indinga, hafta kunlari, 10.09, 10.09.2026,
 *             2026-09-10, 10-sentabr, "3 kundan keyin", "2 haftadan keyin"
 *   vaqt    — 15:00, "soat 3 da", ertalab / tushda / kechqurun,
 *             "2 soatdan keyin", "30 daqiqadan keyin"
 *   takror  — har kuni / har hafta / har dushanba / har oy / har yili
 */

export interface TextParseResult {
  task?: ExtractedTask;
  /** Tushunilmaganda foydalanuvchiga ko'rsatiladigan izoh (HTML). */
  reply?: string;
}

const WEEKDAYS: Record<string, number> = {
  dushanba: 1,
  seshanba: 2,
  chorshanba: 3,
  payshanba: 4,
  juma: 5,
  shanba: 6,
  yakshanba: 7,
};

/** Oy nomlari; ba'zi so'zlar ikki xil yoziladi (sentabr/sentyabr). */
const MONTHS: Record<string, number> = {
  yanvar: 1,
  fevral: 2,
  mart: 3,
  aprel: 4,
  may: 5,
  iyun: 6,
  iyul: 7,
  avgust: 8,
  sentabr: 9,
  sentyabr: 9,
  oktabr: 10,
  oktyabr: 10,
  noyabr: 11,
  dekabr: 12,
};

const DAY_PARTS: Record<string, string> = {
  ertalab: "08:00",
  saharlab: "07:00",
  tushda: "13:00",
  tushlik: "13:00",
  kunduzi: "12:00",
  kechqurun: "20:00",
  kechasi: "21:00",
  kech: "20:00",
};

/** Vaqt aytilmaganda ishlatiladigan standart soat. */
const DEFAULT_TIME = { hour: 9, minute: 0 };

/**
 * Sarlavha chetidan olib tashlanadigan yordamchi so'zlar.
 *
 * Tekshirish **so'z bo'yicha** amalga oshadi, regex bilan emas: aks holda
 * "borish" kabi so'zning ichidan bo'lak kesilib, "ish" bo'lib qolardi.
 */
const FILLER_WORDS = new Set([
  "menga",
  "meni",
  "iltimos",
  "eslat",
  "eslatib",
  "eslatgin",
  "eslatasan",
  "eslatasiz",
  "qoy",
  "qo'y",
  "kerak",
  "bolsin",
  "bo'lsin",
]);

const EDGE_PUNCTUATION = /^[-—–,.:;!?]+|[-—–,.:;!?]+$/g;

interface Span {
  start: number;
  end: number;
}

/** Matndan topilgan bo'laklarni belgilab boradi — sarlavha shulardan tozalanadi. */
class Scanner {
  readonly spans: Span[] = [];

  constructor(readonly lower: string) {}

  /**
   * Regexni qidiradi va birinchi hali "band bo'lmagan" moslikni qaytaradi.
   * Band bo'lgan joylar ustidan ikkinchi marta o'qimaslik uchun shart.
   */
  find(pattern: RegExp): RegExpExecArray | null {
    const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(this.lower)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const start = match.index;
      const end = start + match[0].length;
      if (!this.overlaps(start, end)) return match;
    }
    return null;
  }

  take(match: RegExpExecArray): void {
    this.spans.push({ start: match.index, end: match.index + match[0].length });
  }

  private overlaps(start: number, end: number): boolean {
    return this.spans.some((s) => start < s.end && end > s.start);
  }
}

function stripSpans(original: string, spans: readonly Span[]): string {
  if (spans.length === 0) return original;
  const sorted = [...spans].sort((a, b) => a.start - b.start);

  let result = "";
  let cursor = 0;
  for (const span of sorted) {
    if (span.start > cursor) result += original.slice(cursor, span.start);
    cursor = Math.max(cursor, span.end);
  }
  result += original.slice(cursor);
  return result;
}

function cleanTitle(raw: string): string {
  const tokens = raw.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

  const isDroppable = (token: string): boolean => {
    const word = token.replace(EDGE_PUNCTUATION, "").toLowerCase();
    return word === "" || FILLER_WORDS.has(word);
  };

  while (tokens.length > 0 && isDroppable(tokens[0]!)) tokens.shift();
  while (tokens.length > 0 && isDroppable(tokens[tokens.length - 1]!)) tokens.pop();

  const title = tokens.join(" ").replace(EDGE_PUNCTUATION, "").trim();
  if (!title) return "";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

interface Found {
  recurrence: Recurrence;
  /** Qat'iy sana berilgan bo'lsa. */
  date?: { year?: number; month: number; day: number };
  /** Nisbiy kun siljishi (bugun=0, ertaga=1 ...). */
  dayOffset?: number;
  /** Hafta kuni bo'yicha keyingi sana. */
  weekday?: number;
  /** Aniq vaqt. */
  time?: { hour: number; minute: number };
  /** "2 soatdan keyin" kabi to'liq nisbiy siljish (daqiqada). */
  offsetMinutes?: number;
  timeWasExplicit: boolean;
  anySignal: boolean;
}

function scan(lower: string): { found: Found; scanner: Scanner } {
  const scanner = new Scanner(lower);
  const found: Found = { recurrence: "none", timeWasExplicit: false, anySignal: false };

  const consume = (match: RegExpExecArray | null): RegExpExecArray | null => {
    if (match) {
      scanner.take(match);
      found.anySignal = true;
    }
    return match;
  };

  // ── Takrorlanish ────────────────────────────────────
  const everyWeekday = consume(
    scanner.find(/\bhar\s+(dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba)\b/),
  );
  if (everyWeekday) {
    found.recurrence = "weekly";
    found.weekday = WEEKDAYS[everyWeekday[1]!];
  } else if (consume(scanner.find(/\bhar\s+kuni\b/))) {
    found.recurrence = "daily";
  } else if (consume(scanner.find(/\bhar\s+hafta\b/))) {
    found.recurrence = "weekly";
  } else if (consume(scanner.find(/\bhar\s+oy\b/))) {
    found.recurrence = "monthly";
  } else if (consume(scanner.find(/\bhar\s+yili?\b/))) {
    found.recurrence = "yearly";
  }

  // ── Aniq vaqt: 15:00 ────────────────────────────────
  const colonTime = consume(scanner.find(/\b([01]?\d|2[0-3]):([0-5]\d)\b/));
  if (colonTime) {
    found.time = { hour: Number(colonTime[1]), minute: Number(colonTime[2]) };
    found.timeWasExplicit = true;
  }

  // ── Nisbiy siljishlar ───────────────────────────────
  const after = /(keyin|so'ng|song|keyinroq)/.source;

  const minutesAfter = consume(
    scanner.find(new RegExp(String.raw`\b(\d{1,3})\s*(?:daqiqa|daqiqadan|minut|minutdan|min)\s*${after}\b`)),
  );
  const hoursAfter = minutesAfter
    ? null
    : consume(scanner.find(new RegExp(String.raw`\b(\d{1,3})\s*(?:soat|soatdan)\s*${after}\b`)));
  const daysAfter = consume(
    scanner.find(new RegExp(String.raw`\b(\d{1,3})\s*(?:kun|kundan)\s*${after}\b`)),
  );
  const weeksAfter = consume(
    scanner.find(new RegExp(String.raw`\b(\d{1,3})\s*(?:hafta|haftadan)\s*${after}\b`)),
  );

  if (minutesAfter) found.offsetMinutes = Number(minutesAfter[1]);
  if (hoursAfter) found.offsetMinutes = Number(hoursAfter[1]) * 60;
  if (daysAfter) found.dayOffset = Number(daysAfter[1]);
  if (weeksAfter) found.dayOffset = Number(weeksAfter[1]) * 7;

  // ── Sana ────────────────────────────────────────────
  const iso = consume(scanner.find(/\b(\d{4})-(\d{2})-(\d{2})\b/));
  if (iso) {
    found.date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }

  if (!found.date) {
    // 10.09 yoki 10.09.2026 — oy 1..12 bo'lishi shart, aks holda bu sana emas.
    const numeric = scanner.find(/\b(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?\b/);
    if (numeric) {
      const day = Number(numeric[1]);
      const month = Number(numeric[2]);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        consume(numeric);
        const rawYear = numeric[3] ? Number(numeric[3]) : undefined;
        found.date = {
          day,
          month,
          ...(rawYear === undefined ? {} : { year: rawYear < 100 ? 2000 + rawYear : rawYear }),
        };
      }
    }
  }

  if (!found.date) {
    const monthNames = Object.keys(MONTHS).join("|");
    const named = consume(scanner.find(new RegExp(String.raw`\b(\d{1,2})[-\s]?(${monthNames})\b`)));
    if (named) {
      found.date = { day: Number(named[1]), month: MONTHS[named[2]!]! };
    }
  }

  // ── Nisbiy kunlar ───────────────────────────────────
  if (found.dayOffset === undefined) {
    if (consume(scanner.find(/\bbugun\b/))) found.dayOffset = 0;
    else if (consume(scanner.find(/\bertaga\b/))) found.dayOffset = 1;
    else if (consume(scanner.find(/\bindin(ga|iga)?\b/))) found.dayOffset = 2;
  }

  // ── Hafta kuni ──────────────────────────────────────
  if (found.weekday === undefined) {
    const weekdayNames = Object.keys(WEEKDAYS).join("|");
    const weekday = consume(
      scanner.find(new RegExp(String.raw`\b(?:keyingi|kelasi)?\s*(${weekdayNames})(?:\s+kuni)?\b`)),
    );
    if (weekday) found.weekday = WEEKDAYS[weekday[1]!];
  }

  // ── "soat 3 da" ─────────────────────────────────────
  if (!found.time) {
    const clock = consume(scanner.find(/\bsoat\s+([01]?\d|2[0-3])(?:\s*(?:da|de|larda))?\b/));
    if (clock) {
      let hour = Number(clock[1]);
      // "soat 3 da" deyilganda odatda 15:00 nazarda tutiladi — kechasi soat 3 ga
      // eslatma kamdan-kam qo'yiladi. Ertalabki so'z aytilgan bo'lsa tegilmaydi.
      const morning = /\b(ertalab|saharlab|tongda|kunduzi|tunda|kechasi)\b/.test(lower);
      if (!morning && hour >= 1 && hour <= 7) hour += 12;
      found.time = { hour, minute: 0 };
      found.timeWasExplicit = true;
    }
  }

  // ── Kun qismlari: ertalab, kechqurun ... ────────────
  if (!found.time) {
    const partNames = Object.keys(DAY_PARTS).join("|");
    const part = consume(scanner.find(new RegExp(String.raw`\b(${partNames})\b`)));
    if (part) {
      const [hour, minute] = DAY_PARTS[part[1]!]!.split(":").map(Number);
      found.time = { hour: hour!, minute: minute! };
      found.timeWasExplicit = false;
    }
  }

  // ── Nuqtali vaqt: 15.00 (sana sifatida olinmagan bo'lsa) ──
  if (!found.time) {
    const dotted = consume(scanner.find(/\b([01]?\d|2[0-3])\.([0-5]\d)\b/));
    if (dotted) {
      found.time = { hour: Number(dotted[1]), minute: Number(dotted[2]) };
      found.timeWasExplicit = true;
    }
  }

  return { found, scanner };
}

/** Topilgan bo'laklardan haqiqiy vaqt belgisini yig'adi. */
function resolveDueAt(found: Found, timezone: string, nowMs: number): number | null {
  const now = DateTime.fromMillis(nowMs, { zone: timezone });
  if (!now.isValid) return null;

  // "2 soatdan keyin" — sana/vaqt hisoblarisiz to'g'ridan-to'g'ri siljish.
  if (found.offsetMinutes !== undefined && found.date === undefined && found.weekday === undefined) {
    const target = now.plus({ minutes: found.offsetMinutes }).set({ second: 0, millisecond: 0 });
    return target.isValid ? target.toMillis() : null;
  }

  const time = found.time ?? DEFAULT_TIME;
  let target: DateTime;

  if (found.date) {
    target = now.set({
      year: found.date.year ?? now.year,
      month: found.date.month,
      day: found.date.day,
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    // Yil aytilmagan va sana o'tib ketgan bo'lsa — kelasi yil.
    if (target.isValid && found.date.year === undefined && target < now) {
      target = target.plus({ years: 1 });
    }
  } else if (found.weekday !== undefined) {
    target = now.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    const diff = (found.weekday - target.weekday + 7) % 7;
    target = target.plus({ days: diff });
    if (target <= now) target = target.plus({ weeks: 1 });
  } else if (found.dayOffset !== undefined) {
    target = now
      .plus({ days: found.dayOffset })
      .set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  } else {
    // Faqat vaqt aytilgan: bugun o'tgan bo'lsa ertaga.
    target = now.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
    if (target <= now) target = target.plus({ days: 1 });
  }

  return target.isValid ? target.toMillis() : null;
}

export const TEXT_FORMAT_HINT = [
  "⚠️ Tushunmadim. Matn orqali eslatma quyidagi shakllarda yoziladi:",
  "",
  "• <code>ertaga 15:00 shifokorga borish</code>",
  "• <code>10.09 09:00 uchrashuv</code>",
  "• <code>dushanba ertalab hisobot</code>",
  "• <code>har kuni 08:00 dori ichish</code>",
  "• <code>2 soatdan keyin suv ich</code>",
  "",
  "🎤 Yoki shunchaki <b>ovozli xabar</b> yuboring — u erkin gapni ham tushunadi.",
].join("\n");

/**
 * Matndan bitta eslatma ajratadi. Sana/vaqt belgisi umuman topilmasa yoki
 * sarlavha bo'sh chiqsa — tushunilmagan hisoblanadi va yo'riqnoma qaytariladi.
 */
export function parseTextReminder(
  text: string,
  timezone: string,
  nowMs = Date.now(),
): TextParseResult {
  const original = text.trim();
  if (!original) return { reply: TEXT_FORMAT_HINT };

  let lower = original.toLowerCase();
  // Ba'zi harflar kichkina yozuvda uzunligini o'zgartirishi mumkin — bunda
  // indekslar siljib ketmasligi uchun sarlavhani ham kichik harfdan olamiz.
  const source = lower.length === original.length ? original : lower;
  if (lower.length !== original.length) lower = source.toLowerCase();

  const { found, scanner } = scan(lower);

  if (!found.anySignal) return { reply: TEXT_FORMAT_HINT };

  const dueAt = resolveDueAt(found, timezone, nowMs);
  if (dueAt === null) return { reply: TEXT_FORMAT_HINT };

  const title = cleanTitle(stripSpans(source, scanner.spans));
  if (!title) {
    return {
      reply:
        "⚠️ Vaqtini tushundim, lekin vazifa nomi topilmadi.\n" +
        "Masalan: <code>ertaga 15:00 shifokorga borish</code>",
    };
  }

  return {
    task: {
      title: title.slice(0, 120),
      notes: null,
      dueAt,
      recurrence: found.recurrence,
      timeWasExplicit: found.timeWasExplicit,
    },
  };
}
