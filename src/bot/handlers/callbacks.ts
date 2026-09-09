import type { Context } from "grammy";
import { GrammyError } from "grammy";
import {
  completeOccurrence,
  createTask,
  deleteTask,
  getTaskForUser,
  reschedule,
  setTaskStatus,
} from "../../db/tasks.js";
import { createLogger, describeError } from "../../lib/logger.js";
import { formatUz, humanizeUntil } from "../../lib/time.js";
import { CB } from "../keyboards.js";
import { esc } from "../format.js";

const log = createLogger("bot:callback");

/** Xabar matnini saqlab, ostiga natija satrini qo'shadi va tugmalarni olib tashlaydi. */
async function finalize(ctx: Context, footer: string): Promise<void> {
  const original = ctx.callbackQuery?.message;
  const base = original && "text" in original ? (original.text ?? "") : "";

  try {
    if (base) {
      await ctx.editMessageText(`${esc(base)}\n\n${footer}`, {
        parse_mode: "HTML",
        reply_markup: undefined,
      });
    } else {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(footer, { parse_mode: "HTML" });
    }
  } catch (error) {
    if (error instanceof GrammyError && error.description.includes("is not modified")) return;
    log.warn(`xabar tahrirlanmadi: ${describeError(error)}`);
  }
}

export async function handleCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data || !userId) return;

  const [action, rawId, rawArg] = data.split(":");
  const taskId = Number(rawId);

  if (!action || !Number.isSafeInteger(taskId)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const task = getTaskForUser(taskId, userId);
  if (!task) {
    await ctx.answerCallbackQuery({ text: "Bu eslatma topilmadi (o'chirilgan bo'lishi mumkin).", show_alert: true });
    return;
  }

  switch (action) {
    case CB.done: {
      const occurrenceAt = Number(rawArg);

      if (task.recurrence === "none") {
        setTaskStatus(taskId, userId, "done");
      } else if (Number.isSafeInteger(occurrenceAt)) {
        // Takrorlanuvchi vazifada faqat shu takrorlanish yopiladi, seriya davom etadi.
        completeOccurrence(taskId, occurrenceAt);
      }

      await ctx.answerCallbackQuery({ text: "✅ Bajarildi" });

      const footer =
        task.recurrence === "none"
          ? "✅ <b>Bajarildi</b>"
          : `✅ <b>Bajarildi</b> — keyingisi: ${esc(formatUz(task.due_at, task.timezone))}`;
      await finalize(ctx, footer);
      log.info(`vazifa bajarildi: id=${taskId}, user=${userId}`);
      return;
    }

    case CB.snooze: {
      const minutes = Number(rawArg);
      if (!Number.isSafeInteger(minutes) || minutes <= 0) {
        await ctx.answerCallbackQuery();
        return;
      }

      const newDueAt = Date.now() + minutes * 60_000;

      if (task.recurrence === "none") {
        reschedule(taskId, newDueAt);
      } else {
        // Takrorlanuvchi seriyani surmaymiz — bir martalik nusxa yaratamiz.
        createTask({
          userId,
          title: task.title,
          notes: task.notes,
          dueAt: newDueAt,
          timezone: task.timezone,
          recurrence: "none",
          source: task.source,
          transcript: task.transcript,
        });
      }

      await ctx.answerCallbackQuery({ text: `⏰ ${humanizeUntil(newDueAt)} eslataman` });
      await finalize(
        ctx,
        `⏰ <b>Keyinga surildi:</b> ${esc(formatUz(newDueAt, task.timezone))}`,
      );
      log.info(`vazifa surildi: id=${taskId}, +${minutes}daq`);
      return;
    }

    case CB.remove: {
      const removed = deleteTask(taskId, userId);
      await ctx.answerCallbackQuery({ text: removed ? "🗑 O'chirildi" : "Topilmadi" });
      if (removed) {
        await finalize(ctx, "🗑 <b>Eslatma o'chirildi</b>");
        log.info(`vazifa o'chirildi: id=${taskId}, user=${userId}`);
      }
      return;
    }

    default:
      await ctx.answerCallbackQuery();
  }
}
