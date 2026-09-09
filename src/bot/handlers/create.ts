import type { Context, InlineKeyboard } from "grammy";
import { createTask, type TaskRow, type TaskSource } from "../../db/tasks.js";
import { userTimezone } from "../../db/users.js";
import { extractTasks, ParserError } from "../../services/parser.js";
import { parseTextReminder, TEXT_FORMAT_HINT } from "../../services/text-parser.js";
import { createLogger } from "../../lib/logger.js";
import { extractedPreview, multiTaskHeader, newTaskCard, transcriptNote } from "../format.js";
import { mainInlineKeyboard, newTaskKeyboard } from "../keyboards.js";
import { createStatus, type StatusHandle } from "../status.js";

const log = createLogger("bot:create");

export interface CreateFromTextParams {
  ctx: Context;
  userId: number;
  text: string;
  source: TaskSource;
  /** Ovozdan kelgan xabarda asl transkripsiya — vazifa bilan birga saqlanadi. */
  transcript?: string | null;
  /** Mavjud holat xabari (ovozli oqimda allaqachon yuborilgan bo'ladi). */
  status?: StatusHandle;
}

/**
 * Xabardan eslatma(lar) yaratadi.
 *
 * Manbaga qarab ikki xil yo'l bor:
 *   • **matn** — qoidalar asosidagi tahlilchi (AI'siz): tez, bepul, natijasi
 *     oldindan aniq. Foydalanuvchi yozayotganda aniq shakl bera oladi.
 *   • **ovoz** — til modeli: erkin gapni ham tushunadi.
 */
export async function createTasksFromText(params: CreateFromTextParams): Promise<TaskRow[]> {
  const timezone = userTimezone(params.userId);

  return params.source === "text"
    ? createFromPlainText(params, timezone)
    : createFromSpeech(params, timezone);
}

/** Matnli xabar — qoidalar bilan o'qiladi, hech qanday API chaqirilmaydi. */
async function createFromPlainText(
  params: CreateFromTextParams,
  timezone: string,
): Promise<TaskRow[]> {
  const { ctx, userId, text } = params;

  const result = parseTextReminder(text, timezone);

  if (!result.task) {
    await ctx.reply(result.reply ?? TEXT_FORMAT_HINT, {
      parse_mode: "HTML",
      reply_markup: mainInlineKeyboard(),
    });
    return [];
  }

  const task = createTask({
    userId,
    title: result.task.title,
    notes: result.task.notes,
    dueAt: result.task.dueAt,
    timezone,
    recurrence: result.task.recurrence,
    source: "text",
    transcript: null,
  });

  log.info(`matn orqali vazifa yaratildi (AI'siz): id=${task.id} user=${userId}`);

  await ctx.reply(newTaskCard(task, !result.task.timeWasExplicit), {
    parse_mode: "HTML",
    reply_markup: newTaskKeyboard(task),
  });

  return [task];
}

/** Ovozdan olingan matn — til modeli orqali tahlil qilinadi. */
async function createFromSpeech(
  params: CreateFromTextParams,
  timezone: string,
): Promise<TaskRow[]> {
  const { ctx, userId, text, source, transcript } = params;

  const status = params.status ?? (await createStatus(ctx, "🧠 <i>Tahlil qilinmoqda…</i>"));
  if (params.status) await status.update("🧠 <i>Tahlil qilinmoqda…</i>");

  const transcriptBlock = transcript ? `${transcriptNote(transcript)}\n\n` : "";

  let extraction;
  try {
    extraction = await extractTasks({ text, timezone });
  } catch (error) {
    if (error instanceof ParserError) {
      log.warn(`tahlil xatosi: ${error.message}`);
      await status.update(`${transcriptBlock}⚠️ ${error.userMessage}`);
      return [];
    }
    throw error;
  }

  // Vazifa topilmadi — model izohini yoki standart ko'rsatmani ko'rsatamiz.
  if (extraction.tasks.length === 0) {
    const hint =
      extraction.reply ??
      "Eslatma topilmadi. Masalan shunday yuboring: <i>«ertaga soat 9 da shifokorga borishni eslat»</i>";
    await status.update(`${transcriptBlock}${hint}`, mainInlineKeyboard());
    return [];
  }

  const created: TaskRow[] = [];
  for (const item of extraction.tasks) {
    created.push(
      createTask({
        userId,
        title: item.title,
        notes: item.notes,
        dueAt: item.dueAt,
        timezone,
        recurrence: item.recurrence,
        source,
        transcript: transcript ?? null,
      }),
    );
  }

  log.info(`${created.length} vazifa yaratildi (user=${userId}, source=${source})`);

  if (created.length === 1) {
    const task = created[0]!;
    const guessedTime = !extraction.tasks[0]!.timeWasExplicit;
    await status.update(
      `${transcriptBlock}${newTaskCard(task, guessedTime)}`,
      newTaskKeyboard(task),
    );
    return created;
  }

  const preview = extraction.tasks.map((item) => extractedPreview(item, timezone)).join("\n");
  await status.update(
    `${transcriptBlock}${multiTaskHeader(created.length)}\n\n${preview}`,
    mainInlineKeyboard(),
  );

  return created;
}

export type { InlineKeyboard };
