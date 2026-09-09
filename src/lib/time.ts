import { DateTime, IANAZone } from "luxon";

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

export const UZ_WEEKDAYS = [
  "dushanba",
  "seshanba",
  "chorshanba",
  "payshanba",
  "juma",
  "shanba",
  "yakshanba",
] as const;

export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";

export const RECURRENCE_LABELS_UZ: Record<Recurrence, string> = {
  none: "Takrorlanmaydi",
  daily: "Har kuni",
  weekly: "Har hafta",
  monthly: "Har oy",
  yearly: "Har yili",
};

/** Noto'g'ri/notanish mintaqa nomlari kelib qolsa `fallback`ka tushamiz. */
export function normalizeTimezone(zone: string | null | undefined, fallback: string): string {
  if (zone && IANAZone.isValidZone(zone)) return zone;
  return IANAZone.isValidZone(fallback) ? fallback : "UTC";
}

export function nowMs(): number {
  return Date.now();
}

export function inZone(epochMs: number, zone: string): DateTime {
  return DateTime.fromMillis(epochMs, { zone });
}

/** `2026-09-14` + `14:30` → epoch ms (berilgan mintaqaga nisbatan). */
export function localToEpochMs(
  isoDate: string,
  isoTime: string,
  zone: string,
): number | null {
  const dt = DateTime.fromISO(`${isoDate}T${isoTime}`, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

export function epochMsToLocalParts(
  epochMs: number,
  zone: string,
): { date: string; time: string } {
  const dt = inZone(epochMs, zone);
  return { date: dt.toFormat("yyyy-MM-dd"), time: dt.toFormat("HH:mm") };
}

/** "14-sentabr, dushanba • 09:00" */
export function formatUz(epochMs: number, zone: string): string {
  const dt = inZone(epochMs, zone);
  const month = UZ_MONTHS_GENITIVE[dt.month - 1] ?? dt.toFormat("MM");
  const weekday = UZ_WEEKDAYS[dt.weekday - 1] ?? "";
  return `${dt.day}-${month}, ${weekday} • ${dt.toFormat("HH:mm")}`;
}

/** "14-sentabr • 09:00" — hafta kunisiz qisqa shakl. */
export function formatUzShort(epochMs: number, zone: string): string {
  const dt = inZone(epochMs, zone);
  const month = UZ_MONTHS_GENITIVE[dt.month - 1] ?? dt.toFormat("MM");
  return `${dt.day}-${month} • ${dt.toFormat("HH:mm")}`;
}

/**
 * "3 kundan keyin", "2 soatdan keyin", "5 daqiqa oldin" — eslatmagacha qolgan vaqt.
 * O'zbek tilida son bilan ot kelganda ko'plik qo'shimchasi tushadi, shuning uchun
 * birlik/ko'plik farqlanmaydi.
 */
export function humanizeUntil(targetMs: number, fromMs = Date.now()): string {
  const diff = targetMs - fromMs;
  const past = diff < 0;
  const abs = Math.abs(diff);

  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return past ? "hozir o'tdi" : "bir daqiqadan kam";

  let value: number;
  let unit: string;
  if (minutes < 60) {
    value = minutes;
    unit = "daqiqa";
  } else if (minutes < 60 * 24) {
    value = Math.round(minutes / 60);
    unit = "soat";
  } else if (minutes < 60 * 24 * 30) {
    value = Math.round(minutes / (60 * 24));
    unit = "kun";
  } else {
    value = Math.round(minutes / (60 * 24 * 30));
    unit = "oy";
  }

  return past ? `${value} ${unit} oldin` : `${value} ${unit}dan keyin`;
}

/**
 * Takrorlanuvchi vazifaning keyingi vaqtini hisoblaydi.
 * Mintaqaga nisbatan qadam tashlaydi — shuning uchun yozgi/qishgi vaqt
 * o'zgarsa ham mahalliy soat (masalan 09:00) saqlanadi.
 * Kelasi vaqt `afterMs`dan keyin bo'lishi kafolatlanadi.
 */
export function nextOccurrence(
  currentMs: number,
  recurrence: Recurrence,
  zone: string,
  afterMs = Date.now(),
): number | null {
  if (recurrence === "none") return null;

  const step: Record<Exclude<Recurrence, "none">, Parameters<DateTime["plus"]>[0]> = {
    daily: { days: 1 },
    weekly: { weeks: 1 },
    monthly: { months: 1 },
    yearly: { years: 1 },
  };

  let dt = inZone(currentMs, zone);
  if (!dt.isValid) return null;

  // O'tkazib yuborilgan takrorlanishlar bo'lsa, kelajakka yetguncha oldinga suramiz.
  // Cheklov — buzuq ma'lumot cheksiz tsiklga olib kelmasin.
  for (let i = 0; i < 5000; i += 1) {
    dt = dt.plus(step[recurrence]);
    if (!dt.isValid) return null;
    if (dt.toMillis() > afterMs) return dt.toMillis();
  }
  return null;
}

/** Mintaqadagi kunning boshi/oxiri — kalendar bo'yicha filtrlash uchun. */
export function dayRangeMs(isoDate: string, zone: string): { startMs: number; endMs: number } | null {
  const start = DateTime.fromISO(isoDate, { zone }).startOf("day");
  if (!start.isValid) return null;
  return { startMs: start.toMillis(), endMs: start.plus({ days: 1 }).toMillis() };
}

/** `2026-09` oyining boshidan keyingi oy boshiga qadar. */
export function monthRangeMs(
  year: number,
  month: number,
  zone: string,
): { startMs: number; endMs: number } | null {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf("day");
  if (!start.isValid) return null;
  return { startMs: start.toMillis(), endMs: start.plus({ months: 1 }).toMillis() };
}
