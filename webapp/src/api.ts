import { webApp } from "./telegram";
import type {
  BootstrapResponse,
  OccurrencesResponse,
  Task,
  TaskDetail,
  TaskInput,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  // Telegram initData — server uni bot tokeni bilan HMAC orqali tekshiradi.
  const initData = webApp?.initData;
  if (initData) headers.set("Authorization", `tma ${initData}`);

  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("Serverga ulanib bo'lmadi. Internetni tekshiring.", 0);
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? `Xatolik (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload as T;
}

export function fetchBootstrap(): Promise<BootstrapResponse> {
  return request<BootstrapResponse>("/api/bootstrap");
}

/** `from` va `to` — foydalanuvchi mintaqasidagi `YYYY-MM-DD` sanalar (ikkisi ham qamrovda). */
export function fetchOccurrences(from: string, to: string): Promise<OccurrencesResponse> {
  const query = new URLSearchParams({ from, to });
  return request<OccurrencesResponse>(`/api/occurrences?${query}`);
}

export function fetchTask(id: number): Promise<TaskDetail> {
  return request<TaskDetail>(`/api/tasks/${id}`);
}

export async function createTask(input: TaskInput): Promise<Task> {
  const result = await request<{ task: Task }>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.task;
}

export async function updateTask(id: number, patch: Partial<TaskInput>): Promise<Task> {
  const result = await request<{ task: Task }>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return result.task;
}

export function deleteTask(id: number): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: "DELETE" });
}

/**
 * Bitta takrorlanishni (yoki bir martalik vazifani) bajarilgan/bajarilmagan qiladi.
 * `occurrenceAt` — aynan shu nusxaning vaqti.
 */
export function setCompleted(
  id: number,
  occurrenceAt: number,
  completed: boolean,
): Promise<unknown> {
  return request(`/api/tasks/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ occurrenceAt, completed }),
  });
}

export async function updateTimezone(timezone: string): Promise<string> {
  const result = await request<{ timezone: string }>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({ timezone }),
  });
  return result.timezone;
}
