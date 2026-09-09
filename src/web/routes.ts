import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { IANAZone } from "luxon";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";
import {
  completeOccurrence,
  completionsForTask,
  completionKeysInRange,
  createTask,
  deleteTask,
  getTaskForUser,
  listOneOffTasksInRange,
  listRecurringTasks,
  uncompleteOccurrence,
  updateTask,
  type TaskRow,
} from "../db/tasks.js";
import { setUserTimezone, upsertUser, userTimezone } from "../db/users.js";
import { buildOccurrences } from "../lib/occurrences.js";
import {
  dayRangeMs,
  epochMsToLocalParts,
  localToEpochMs,
  normalizeTimezone,
} from "../lib/time.js";
import { extractInitData, verifyInitData } from "./auth.js";

const log = createLogger("api");

/** Autentifikatsiyadan o'tgan foydalanuvchi so'rovga shu maydonda ilinadi. */
interface AuthedRequest extends FastifyRequest {
  telegramUserId?: number;
}

const RECURRENCE = ["none", "daily", "weekly", "monthly", "yearly"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana YYYY-MM-DD shaklida bo'lishi kerak");
const isoTime = z.string().regex(/^\d{2}:\d{2}$/, "Vaqt HH:mm shaklida bo'lishi kerak");

const rangeQuerySchema = z.object({
  from: isoDate,
  to: isoDate,
});

const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Sarlavha bo'sh").max(200),
  notes: z.string().trim().max(1000).nullish(),
  date: isoDate,
  time: isoTime,
  recurrence: z.enum(RECURRENCE).default("none"),
});

const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().trim().max(1000).nullish(),
    date: isoDate.optional(),
    time: isoTime.optional(),
    recurrence: z.enum(RECURRENCE).optional(),
    status: z.enum(["pending", "done", "cancelled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "O'zgartirish uchun maydon berilmadi" });

const completeSchema = z.object({
  occurrenceAt: z.number().int(),
  completed: z.boolean(),
});

const settingsSchema = z.object({
  timezone: z.string().trim().min(1),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Vazifa qatorini API javob shakliga o'giradi. */
function serializeTask(task: TaskRow) {
  const due = epochMsToLocalParts(task.due_at, task.timezone);
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    dueAt: task.due_at,
    date: due.date,
    time: due.time,
    timezone: task.timezone,
    recurrence: task.recurrence,
    status: task.status,
    source: task.source,
    transcript: task.transcript,
    createdAt: task.created_at,
  };
}

export function registerApiRoutes(app: FastifyInstance): void {
  /** /api/* uchun Telegram initData tekshiruvi. */
  app.addHook("preHandler", async (request: AuthedRequest, reply: FastifyReply) => {
    if (!request.url.startsWith("/api/")) return;

    const initData = extractInitData(request.headers as Record<string, unknown>);
    if (!initData) {
      return reply.code(401).send({ error: "Telegram initData yuborilmadi" });
    }

    const result = verifyInitData(initData);
    if (!result.ok) {
      log.warn(`initData tekshiruvidan o'tmadi: ${result.reason}`);
      return reply.code(401).send({ error: "Autentifikatsiya muvaffaqiyatsiz" });
    }

    request.telegramUserId = result.data.user.id;

    // Mini App orqali birinchi kirishda ham foydalanuvchi yozuvi paydo bo'lsin.
    upsertUser({
      telegramId: result.data.user.id,
      firstName: result.data.user.first_name ?? null,
      username: result.data.user.username ?? null,
      languageCode: result.data.user.language_code ?? null,
    });
  });

  /** Har bir handler uchun foydalanuvchi ID — hook o'tgani kafolatlangan. */
  const uid = (request: AuthedRequest): number => {
    const id = request.telegramUserId;
    if (id === undefined) throw new Error("telegramUserId yo'q — hook ishlamagan");
    return id;
  };

  app.get("/api/bootstrap", async (request: AuthedRequest) => {
    const userId = uid(request);
    const timezone = userTimezone(userId);
    return {
      userId,
      timezone,
      defaultTimezone: config.defaultTimezone,
      serverNow: Date.now(),
    };
  });

  /** Kalendar oralig'idagi barcha hodisalar (takrorlanishlar yozib chiqilgan holda). */
  app.get("/api/occurrences", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const query = rangeQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.issues[0]?.message ?? "Noto'g'ri oraliq" });
    }

    const timezone = userTimezone(userId);
    const start = dayRangeMs(query.data.from, timezone);
    const end = dayRangeMs(query.data.to, timezone);
    if (!start || !end) {
      return reply.code(400).send({ error: "Sanani o'qib bo'lmadi" });
    }

    // `to` sanasi ham qamrovga kirsin — shu kunning oxirigacha.
    const startMs = start.startMs;
    const endMs = end.endMs;
    if (endMs <= startMs) {
      return reply.code(400).send({ error: "`to` sanasi `from`dan keyin bo'lishi kerak" });
    }

    const occurrences = buildOccurrences({
      oneOffs: listOneOffTasksInRange(userId, startMs, endMs),
      recurring: listRecurringTasks(userId),
      completionKeys: completionKeysInRange(userId, startMs, endMs),
      startMs,
      endMs,
    });

    return {
      timezone,
      from: query.data.from,
      to: query.data.to,
      serverNow: Date.now(),
      occurrences: occurrences.map((occurrence) => {
        const parts = epochMsToLocalParts(occurrence.occurrenceAt, timezone);
        return {
          taskId: occurrence.taskId,
          title: occurrence.title,
          notes: occurrence.notes,
          occurrenceAt: occurrence.occurrenceAt,
          date: parts.date,
          time: parts.time,
          recurrence: occurrence.recurrence,
          source: occurrence.source,
          completed: occurrence.completed,
          cancelled: occurrence.cancelled,
          hasTranscript: occurrence.transcript !== null,
        };
      }),
    };
  });

  app.get("/api/tasks/:id", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Noto'g'ri id" });

    const task = getTaskForUser(params.data.id, userId);
    if (!task) return reply.code(404).send({ error: "Eslatma topilmadi" });

    return {
      task: serializeTask(task),
      completions: task.recurrence === "none" ? [] : completionsForTask(task.id),
    };
  });

  app.post("/api/tasks", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const body = createTaskSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Noto'g'ri ma'lumot" });
    }

    const timezone = userTimezone(userId);
    const dueAt = localToEpochMs(body.data.date, body.data.time, timezone);
    if (dueAt === null) {
      return reply.code(400).send({ error: "Sana yoki vaqt noto'g'ri" });
    }

    const notes = body.data.notes?.trim();
    const task = createTask({
      userId,
      title: body.data.title,
      notes: notes ? notes : null,
      dueAt,
      timezone,
      recurrence: body.data.recurrence,
      source: "manual",
    });

    log.info(`Mini App orqali vazifa yaratildi: id=${task.id} user=${userId}`);
    return reply.code(201).send({ task: serializeTask(task) });
  });

  app.patch("/api/tasks/:id", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Noto'g'ri id" });

    const body = updateTaskSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Noto'g'ri ma'lumot" });
    }

    const existing = getTaskForUser(params.data.id, userId);
    if (!existing) return reply.code(404).send({ error: "Eslatma topilmadi" });

    const patch: Parameters<typeof updateTask>[2] = {};
    if (body.data.title !== undefined) patch.title = body.data.title;
    if (body.data.notes !== undefined) {
      const trimmed = body.data.notes?.trim();
      patch.notes = trimmed ? trimmed : null;
    }
    if (body.data.recurrence !== undefined) patch.recurrence = body.data.recurrence;
    if (body.data.status !== undefined) patch.status = body.data.status;

    // Sana yoki vaqtdan bittasi kelsa, ikkinchisini mavjud qiymatdan olamiz.
    if (body.data.date !== undefined || body.data.time !== undefined) {
      const current = epochMsToLocalParts(existing.due_at, existing.timezone);
      const nextDate = body.data.date ?? current.date;
      const nextTime = body.data.time ?? current.time;
      const dueAt = localToEpochMs(nextDate, nextTime, existing.timezone);
      if (dueAt === null) return reply.code(400).send({ error: "Sana yoki vaqt noto'g'ri" });
      patch.dueAt = dueAt;
    }

    const updated = updateTask(params.data.id, userId, patch);
    if (!updated) return reply.code(404).send({ error: "Eslatma topilmadi" });

    return { task: serializeTask(updated) };
  });

  app.delete("/api/tasks/:id", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Noto'g'ri id" });

    const removed = deleteTask(params.data.id, userId);
    if (!removed) return reply.code(404).send({ error: "Eslatma topilmadi" });

    return { ok: true };
  });

  /** Bitta takrorlanishni (yoki bir martalik vazifani) bajarilgan deb belgilash. */
  app.post("/api/tasks/:id/complete", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Noto'g'ri id" });

    const body = completeSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Noto'g'ri ma'lumot" });
    }

    const task = getTaskForUser(params.data.id, userId);
    if (!task) return reply.code(404).send({ error: "Eslatma topilmadi" });

    if (task.recurrence === "none") {
      const updated = updateTask(task.id, userId, {
        status: body.data.completed ? "done" : "pending",
      });
      return { task: updated ? serializeTask(updated) : null };
    }

    if (body.data.completed) {
      completeOccurrence(task.id, body.data.occurrenceAt);
    } else {
      uncompleteOccurrence(task.id, body.data.occurrenceAt);
    }

    return { ok: true, occurrenceAt: body.data.occurrenceAt, completed: body.data.completed };
  });

  app.patch("/api/settings", async (request: AuthedRequest, reply: FastifyReply) => {
    const userId = uid(request);
    const body = settingsSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Vaqt mintaqasi ko'rsatilmadi" });
    }

    if (!IANAZone.isValidZone(body.data.timezone)) {
      return reply.code(400).send({ error: "Noto'g'ri vaqt mintaqasi" });
    }

    const applied = setUserTimezone(
      userId,
      normalizeTimezone(body.data.timezone, config.defaultTimezone),
    );
    return { timezone: applied };
  });
}
