export const UZ_MONTHS = [
  "Yanvar",
  "Fevral",
  "Mart",
  "Aprel",
  "May",
  "Iyun",
  "Iyul",
  "Avgust",
  "Sentabr",
  "Oktabr",
  "Noyabr",
  "Dekabr",
] as const;

export const UZ_MONTHS_GENITIVE = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
] as const;

/** Dushanbadan boshlanadigan hafta. */
export const UZ_WEEKDAYS_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"] as const;

export const UZ_WEEKDAYS_FULL = [
  "dushanba",
  "seshanba",
  "chorshanba",
  "payshanba",
  "juma",
  "shanba",
  "yakshanba",
] as const;

export interface YearMonth {
  year: number;
  /** 1-12 */
  month: number;
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function toIsoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** `YYYY-MM-DD` → qismlarga. Noto'g'ri satr uchun `null`. */
export function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/**
 * Berilgan mintaqadagi bugungi sana, `YYYY-MM-DD`.
 * `en-CA` locale aynan ISO tartibida chiqaradi, shuning uchun qo'shimcha ishlov shart emas.
 */
export function todayIso(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

export function isoToYearMonth(iso: string): YearMonth {
  const parts = parseIsoDate(iso);
  if (!parts) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  return { year: parts.year, month: parts.month };
}

export function addMonths(value: YearMonth, delta: number): YearMonth {
  // 0-indeksli oy bilan hisoblash yil chegarasidan o'tishni o'zi hal qiladi.
  const zeroBased = value.month - 1 + delta;
  return {
    year: value.year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Oyning 1-kuni haftaning nechanchi kuni (0 = dushanba … 6 = yakshanba). */
function firstWeekdayIndex(year: number, month: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0 = yakshanba
  return (jsDay + 6) % 7;
}

export interface CalendarCell {
  iso: string;
  day: number;
  /** Joriy oyga tegishlimi (yon oylardan to'ldiruvchi kunlar `false`). */
  inMonth: boolean;
}

/**
 * Oy uchun 6×7 katakli setka quradi — qatorlar soni doim bir xil bo'lgani uchun
 * oylar almashganda kalendar balandligi sakramaydi.
 */
export function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const cells: CalendarCell[] = [];
  const lead = firstWeekdayIndex(year, month);
  const total = daysInMonth(year, month);

  const prev = addMonths({ year, month }, -1);
  const prevTotal = daysInMonth(prev.year, prev.month);
  for (let i = lead - 1; i >= 0; i -= 1) {
    const day = prevTotal - i;
    cells.push({ iso: toIsoDate(prev.year, prev.month, day), day, inMonth: false });
  }

  for (let day = 1; day <= total; day += 1) {
    cells.push({ iso: toIsoDate(year, month, day), day, inMonth: true });
  }

  const next = addMonths({ year, month }, 1);
  let day = 1;
  while (cells.length < 42) {
    cells.push({ iso: toIsoDate(next.year, next.month, day), day, inMonth: false });
    day += 1;
  }

  return cells;
}

export function monthTitle(value: YearMonth): string {
  return `${UZ_MONTHS[value.month - 1] ?? ""} ${value.year}`;
}

/** "14-sentabr, dushanba" */
export function formatDayTitle(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;

  const jsDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  const weekday = UZ_WEEKDAYS_FULL[(jsDay + 6) % 7] ?? "";
  const month = UZ_MONTHS_GENITIVE[parts.month - 1] ?? "";
  return `${parts.day}-${month}, ${weekday}`;
}

/** Oy ko'rinishi uchun so'raladigan oraliq — yon oylardan to'ldiruvchi kunlar ham kiradi. */
export function monthRangeIso(value: YearMonth): { from: string; to: string } {
  const grid = buildMonthGrid(value.year, value.month);
  return { from: grid[0]!.iso, to: grid[grid.length - 1]!.iso };
}

/** Hozirgi mintaqa nomi — foydalanuvchi sozlamaganida taklif sifatida ishlatiladi. */
export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tashkent";
  } catch {
    return "Asia/Tashkent";
  }
}
