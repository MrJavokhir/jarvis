import type { Context, InlineKeyboard } from "grammy";
import { createTask, type TaskRow, type TaskSource } from "../../db/tasks.js";
import { userTimezone } from "../../db/users.js";
import { extractTasks, ParserError } from "../../services/parser.js";
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
 * Matndan eslatma(lar) yaratadi va foydalanuvchiga tasdiq yuboradi.
 * Ovozli va matnli xabarlar uchun umumiy yo'l.
 */
export async function createTasksFromText(params: CreateFromTextParams): Promise<TaskRow[]> {
  const { ctx, userId, text, source, transcript } = params;
  const timezone = userTimezone(userId);

  const status = params.status ?? (await createStatus(ctx, "🧠 <i>Tahlil qilinmoqda…</i>"));
  if (params.status) await status.update("🧠 <i>Tahlil qilinmoqda…</i>");

  const transcriptBlock =
    source === "voice" && transcript ? `${transcriptNote(transcript)}\n\n` : "";

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
