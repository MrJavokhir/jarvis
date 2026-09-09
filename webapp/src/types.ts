export type Recurrence = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type TaskSource = "voice" | "text" | "manual";
export type TaskStatus = "pending" | "done" | "cancelled";

/** Kalendarda ko'rinadigan bitta hodisa (takrorlanishning bir qadami ham shu shaklda). */
export interface Occurrence {
  taskId: number;
  title: string;
  notes: string | null;
  occurrenceAt: number;
  /** Foydalanuvchi mintaqasidagi sana, `YYYY-MM-DD`. */
  date: string;
  /** Foydalanuvchi mintaqasidagi vaqt, `HH:mm`. */
  time: string;
  recurrence: Recurrence;
  source: TaskSource;
  completed: boolean;
  cancelled: boolean;
  hasTranscript: boolean;
}

export interface OccurrencesResponse {
  timezone: string;
  from: string;
  to: string;
  serverNow: number;
  occurrences: Occurrence[];
}

export interface BootstrapResponse {
  userId: number;
  timezone: string;
  defaultTimezone: string;
  serverNow: number;
}

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  dueAt: number;
  date: string;
  time: string;
  timezone: string;
  recurrence: Recurrence;
  status: TaskStatus;
  source: TaskSource;
  transcript: string | null;
  createdAt: number;
}

export interface TaskDetail {
  task: Task;
  completions: number[];
}

export interface TaskInput {
  title: string;
  notes: string | null;
  date: string;
  time: string;
  recurrence: Recurrence;
}
