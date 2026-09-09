import { db } from "./index.js";
import type { Recurrence } from "../lib/time.js";
import { nextOccurrence } from "../lib/time.js";

export type TaskStatus = "pending" | "done" | "cancelled";
export type TaskSource = "voice" | "text" | "manual";

export interface TaskRow {
  id: number;
  user_id: number;
  title: string;
  notes: string | null;
  anchor_at: number;
  due_at: number;
  timezone: string;
  recurrence: Recurrence;
  status: TaskStatus;
  source: TaskSource;
  transcript: string | null;
  notified_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreateTaskInput {
  userId: number;
  title: string;
  notes?: string | null;
  dueAt: number;
  timezone: string;
  recurrence?: Recurrence;
  source?: TaskSource;
  transcript?: string | null;
  /** Allaqachon o'tib ketgan vaqt kiritilsa eslatma yubormaslik uchun oldindan belgilash. */
  notifiedAt?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  dueAt?: number;
  timezone?: string;
  recurrence?: Recurrence;
  status?: TaskStatus;
}

const insertTask = db.prepare(
  `INSERT INTO tasks
     (user_id, title, notes, anchor_at, due_at, timezone, recurrence, status,
      source, transcript, notified_at, created_at, updated_at)
   VALUES
     (@user_id, @title, @notes, @anchor_at, @due_at, @timezone, @recurrence, 'pending',
      @source, @transcript, @notified_at, @now, @now)`,
);

const selectTaskById = db.prepare<[number], TaskRow>(`SELECT * FROM tasks WHERE id = ?`);

const selectTaskForUser = db.prepare<[number, number], TaskRow>(
  `SELECT * FROM tasks WHERE id = ? AND user_id = ?`,
);

const deleteTaskStmt = db.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`);

const selectDue = db.prepare<[number, number], TaskRow>(
  `SELECT * FROM tasks
    WHERE status = 'pending'
      AND notified_at IS NULL
      AND due_at <= ?
    ORDER BY due_at ASC
    LIMIT ?`,
);

const markNotifiedStmt = db.prepare(
  `UPDATE tasks SET notified_at = ?, updated_at = ? WHERE id = ?`,
);

const rescheduleStmt = db.prepare(
  `UPDATE tasks SET due_at = ?, notified_at = NULL, updated_at = ? WHERE id = ?`,
);

const setStatusStmt = db.prepare(
  `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
);

const insertCompletion = db.prepare(
  `INSERT INTO task_completions (task_id, occurrence_at, completed_at)
   VALUES (?, ?, ?)
   ON CONFLICT (task_id, occurrence_at) DO NOTHING`,
);

const deleteCompletionStmt = db.prepare(
  `DELETE FROM task_completions WHERE task_id = ? AND occurrence_at = ?`,
);

const selectCompletionsInRange = db.prepare<
  [number, number, number],
  { task_id: number; occurrence_at: number }
>(
  `SELECT c.task_id, c.occurrence_at
     FROM task_completions c
     JOIN tasks t ON t.id = c.task_id
    WHERE t.user_id = ? AND c.occurrence_at >= ? AND c.occurrence_at < ?`,
);

const selectCompletionsForTask = db.prepare<[number], { occurrence_at: number }>(
  `SELECT occurrence_at FROM task_completions WHERE task_id = ?`,
);

export function createTask(input: CreateTaskInput): TaskRow {
  const now = Date.now();
  const result = insertTask.run({
    user_id: input.userId,
    title: input.title,
    notes: input.notes ?? null,
    anchor_at: input.dueAt,
    due_at: input.dueAt,
    timezone: input.timezone,
    recurrence: input.recurrence ?? "none",
    source: input.source ?? "manual",
    transcript: input.transcript ?? null,
    notified_at: input.notifiedAt ?? null,
    now,
  });
  const task = selectTaskById.get(Number(result.lastInsertRowid));
  if (!task) throw new Error("Vazifa saqlanmadi");
  return task;
}

export function getTask(id: number): TaskRow | undefined {
  return selectTaskById.get(id);
}

export function getTaskForUser(id: number, userId: number): TaskRow | undefined {
  return selectTaskForUser.get(id, userId);
}

/**
 * Vazifani yangilaydi. `dueAt` o'zgarsa `anchor_at` ham suriladi va `notified_at`
 * tozalanadi — yangi vaqtda eslatma qaytadan yuborilishi kerak.
 */
export function updateTask(
  id: number,
  userId: number,
  patch: UpdateTaskInput,
): TaskRow | undefined {
  const existing = selectTaskForUser.get(id, userId);
  if (!existing) return undefined;

  const fields: string[] = [];
  const values: unknown[] = [];

  const push = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.title !== undefined) push("title", patch.title);
  if (patch.notes !== undefined) push("notes", patch.notes);
  if (patch.timezone !== undefined) push("timezone", patch.timezone);
  if (patch.recurrence !== undefined) push("recurrence", patch.recurrence);
  if (patch.status !== undefined) {
    push("status", patch.status);
    push("completed_at", patch.status === "done" ? Date.now() : null);
  }
  if (patch.dueAt !== undefined && patch.dueAt !== existing.due_at) {
    push("due_at", patch.dueAt);
    push("anchor_at", patch.dueAt);
    push("notified_at", null);
  }

  if (fields.length === 0) return existing;

  push("updated_at", Date.now());
  values.push(id, userId);

  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ? AND user_id = ?`).run(...values);
  return selectTaskForUser.get(id, userId);
}

export function deleteTask(id: number, userId: number): boolean {
  return deleteTaskStmt.run(id, userId).changes > 0;
}

/** Eslatma vaqti kelgan, hali xabar berilmagan vazifalar. */
export function findDueTasks(nowMs: number, limit = 100): TaskRow[] {
  return selectDue.all(nowMs, limit);
}

export function markNotified(id: number, at = Date.now()): void {
  markNotifiedStmt.run(at, at, id);
}

/** Vazifani yangi vaqtga suradi va eslatma bayrog'ini tozalaydi (snooze / takrorlanish). */
export function reschedule(id: number, dueAt: number): void {
  rescheduleStmt.run(dueAt, Date.now(), id);
}

/**
 * Takrorlanuvchi vazifani keyingi takrorlanishga suradi.
 * Keyingi vaqt topilmasa vazifa "xabar berilgan" deb belgilanadi va seriya to'xtaydi.
 */
export function advanceRecurring(task: TaskRow, afterMs = Date.now()): number | null {
  const next = nextOccurrence(task.due_at, task.recurrence, task.timezone, afterMs);
  if (next === null) {
    markNotifiedStmt.run(afterMs, afterMs, task.id);
    return null;
  }
  rescheduleStmt.run(next, Date.now(), task.id);
  return next;
}

export function setTaskStatus(
  id: number,
  userId: number,
  status: TaskStatus,
): TaskRow | undefined {
  setStatusStmt.run(status, status === "done" ? Date.now() : null, Date.now(), id, userId);
  return selectTaskForUser.get(id, userId);
}

/** Takrorlanuvchi vazifaning aynan bitta takrorlanishini bajarilgan deb belgilaydi. */
export function completeOccurrence(taskId: number, occurrenceAt: number): void {
  insertCompletion.run(taskId, occurrenceAt, Date.now());
}

export function uncompleteOccurrence(taskId: number, occurrenceAt: number): void {
  deleteCompletionStmt.run(taskId, occurrenceAt);
}

export function completionsForTask(taskId: number): number[] {
  return selectCompletionsForTask.all(taskId).map((row) => row.occurrence_at);
}

/** Kalit shakli: `${taskId}:${occurrenceAt}`. */
export function completionKeysInRange(
  userId: number,
  startMs: number,
  endMs: number,
): Set<string> {
  const rows = selectCompletionsInRange.all(userId, startMs, endMs);
  return new Set(rows.map((r) => `${r.task_id}:${r.occurrence_at}`));
}

/** Bir martalik (takrorlanmaydigan) vazifalarni vaqt oralig'i bo'yicha oladi. */
export function listOneOffTasksInRange(
  userId: number,
  startMs: number,
  endMs: number,
): TaskRow[] {
  return db
    .prepare<[number, number, number], TaskRow>(
      `SELECT * FROM tasks
        WHERE user_id = ? AND recurrence = 'none' AND due_at >= ? AND due_at < ?
        ORDER BY due_at ASC`,
    )
    .all(userId, startMs, endMs);
}

/** Takrorlanuvchi vazifalar — kalendarda oraliqqa yozish uchun hammasi kerak. */
export function listRecurringTasks(userId: number): TaskRow[] {
  return db
    .prepare<[number], TaskRow>(
      `SELECT * FROM tasks
        WHERE user_id = ? AND recurrence != 'none' AND status != 'cancelled'
        ORDER BY due_at ASC`,
    )
    .all(userId);
}

/** Yaqinlashib kelayotgan bir martalik vazifalar (bot ichidagi ro'yxat uchun). */
export function listUpcoming(userId: number, limit = 10): TaskRow[] {
  return db
    .prepare<[number, number, number], TaskRow>(
      `SELECT * FROM tasks
        WHERE user_id = ?
          AND status = 'pending'
          AND (recurrence != 'none' OR due_at >= ?)
        ORDER BY due_at ASC
        LIMIT ?`,
    )
    .all(userId, Date.now() - 24 * 60 * 60 * 1000, limit);
}

export function countPending(userId: number): number {
  const row = db
    .prepare<[number], { c: number }>(
      `SELECT COUNT(*) AS c FROM tasks WHERE user_id = ? AND status = 'pending'`,
    )
    .get(userId);
  return row?.c ?? 0;
}
