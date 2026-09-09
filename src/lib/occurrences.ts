import { DateTime } from "luxon";
import type { TaskRow } from "../db/tasks.js";
import type { Recurrence } from "./time.js";

/** Kalendarga chiziladigan bitta hodisa — bir martalik vazifa yoki takrorlanishning bir nusxasi. */
export interface Occurrence {
  /** `${taskId}:${occurrenceAt}` — mini appda barqaror React key sifatida ishlatiladi. */
  key: string;
  taskId: number;
  title: string;
  notes: string | null;
  /** Shu nusxaning aniq vaqti (epoch ms). */
  occurrenceAt: number;
  timezone: string;
  recurrence: Recurrence;
  source: TaskRow["source"];
  /** Shu aynan nusxa bajarilganmi. */
  completed: boolean;
  /** Seriya (yoki bir martalik vazifa) bekor qilinganmi. */
  cancelled: boolean;
  /** Ovozdan olingan asl matn — bo'lsa mini appda ko'rsatiladi. */
  transcript: string | null;
  /** `true` bo'lsa bu bir martalik vazifa (takrorlanish nusxasi emas). */
  single: boolean;
}

const STEP: Record<Exclude<Recurrence, "none">, Parameters<DateTime["plus"]>[0]> = {
  daily: { days: 1 },
  weekly: { weeks: 1 },
  monthly: { months: 1 },
  yearly: { years: 1 },
};

/** Bitta takrorlanishlar seriyasi bir oraliqda maksimal nechta nusxa bera oladi. */
const MAX_OCCURRENCES_PER_RANGE = 400;

/**
 * Takrorlanuvchi vazifani `[startMs, endMs)` oralig'idagi nusxalarga yoyadi.
 *
 * Qadam vazifaning o'z mintaqasida tashlanadi, shuning uchun soat siljishi
 * (yozgi vaqt va h.k.) bo'lsa ham mahalliy vaqt — masalan har kuni 09:00 — saqlanadi.
 */
export function expandRecurring(task: TaskRow, startMs: number, endMs: number): number[] {
  if (task.recurrence === "none") {
    return task.anchor_at >= startMs && task.anchor_at < endMs ? [task.anchor_at] : [];
  }

  const step = STEP[task.recurrence];
  let cursor = DateTime.fromMillis(task.anchor_at, { zone: task.timezone });
  if (!cursor.isValid) return [];

  // Oraliqning boshiga tez yetib olamiz: kunlik/haftalik uchun matematik sakrash,
  // oylik/yillikda esa oy uzunligi turlichaligi sababli qadamma-qadam yuramiz.
  if (cursor.toMillis() < startMs) {
    if (task.recurrence === "daily" || task.recurrence === "weekly") {
      const spanMs = task.recurrence === "daily" ? 86_400_000 : 7 * 86_400_000;
      const skips = Math.floor((startMs - cursor.toMillis()) / spanMs);
      if (skips > 0) {
        const jumped =
          task.recurrence === "daily"
            ? cursor.plus({ days: skips })
            : cursor.plus({ weeks: skips });
        if (jumped.isValid) cursor = jumped;
      }
    }

    let guard = 0;
    while (cursor.toMillis() < startMs && guard < 10_000) {
      const next = cursor.plus(step);
      if (!next.isValid) return [];
      cursor = next;
      guard += 1;
    }
    if (guard >= 10_000) return [];
  }

  const result: number[] = [];
  while (cursor.toMillis() < endMs && result.length < MAX_OCCURRENCES_PER_RANGE) {
    if (cursor.toMillis() >= startMs) result.push(cursor.toMillis());
    const next = cursor.plus(step);
    if (!next.isValid) break;
    cursor = next;
  }

  return result;
}

export interface BuildOccurrencesInput {
  /** Oraliqqa tushadigan bir martalik vazifalar. */
  oneOffs: TaskRow[];
  /** Foydalanuvchining barcha takrorlanuvchi vazifalari (oraliqqa shu yerda kesiladi). */
  recurring: TaskRow[];
  startMs: number;
  endMs: number;
  /** `${taskId}:${occurrenceAt}` ko'rinishidagi bajarilgan nusxalar to'plami. */
  completionKeys: Set<string>;
}

function toOccurrence(task: TaskRow, occurrenceAt: number, completed: boolean): Occurrence {
  return {
    key: `${task.id}:${occurrenceAt}`,
    taskId: task.id,
    title: task.title,
    notes: task.notes,
    occurrenceAt,
    timezone: task.timezone,
    recurrence: task.recurrence,
    source: task.source,
    completed,
    cancelled: task.status === "cancelled",
    transcript: task.transcript,
    single: task.recurrence === "none",
  };
}

/** Bir martalik va takrorlanuvchi vazifalarni bitta vaqt bo'yicha saralangan ro'yxatga birlashtiradi. */
export function buildOccurrences(input: BuildOccurrencesInput): Occurrence[] {
  const { oneOffs, recurring, startMs, endMs, completionKeys } = input;
  const result: Occurrence[] = [];

  for (const task of oneOffs) {
    result.push(toOccurrence(task, task.due_at, task.status === "done"));
  }

  for (const task of recurring) {
    for (const at of expandRecurring(task, startMs, endMs)) {
      result.push(toOccurrence(task, at, completionKeys.has(`${task.id}:${at}`)));
    }
  }

  result.sort((a, b) => a.occurrenceAt - b.occurrenceAt || a.taskId - b.taskId);
  return result;
}
