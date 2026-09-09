import { GrammyError } from "grammy";
import { bot } from "../bot/index.js";
import { reminderMessage } from "../bot/format.js";
import { reminderKeyboard } from "../bot/keyboards.js";
import { advanceRecurring, findDueTasks, markNotified, setTaskStatus, type TaskRow } from "../db/tasks.js";
import { config } from "../config.js";
import { createLogger, describeError } from "../lib/logger.js";
import { formatUz } from "../lib/time.js";

const log = createLogger("scheduler");

let timer: NodeJS.Timeout | undefined;
/** Bir sikl tugamasdan keyingisi boshlanmasligi uchun. */
let running = false;

/**
 * Foydalanuvchi botni bloklagan yoki chat o'chirilgan holatlar.
 * Bunda qayta urinish foydasiz — vazifani yopamiz.
 */
function isPermanentDeliveryFailure(error: unknown): boolean {
  if (!(error instanceof GrammyError)) return false;
  if (error.error_code === 403) return true;
  if (error.error_code === 400) {
    const d = error.description.toLowerCase();
    return d.includes("chat not found") || d.includes("user is deactivated");
  }
  return false;
}

async function deliver(task: TaskRow): Promise<void> {
  // Takrorlanuvchi vazifada aynan shu takrorlanish vaqtini eslab qolamiz —
  // "Bajarildi" tugmasi to'g'ri qadamni yopishi uchun.
  const occurrenceAt = task.due_at;

  await bot.api.sendMessage(task.user_id, reminderMessage(task, occurrenceAt), {
    parse_mode: "HTML",
    reply_markup: reminderKeyboard(task, occurrenceAt),
  });
}

/** Vaqti kelgan barcha eslatmalarni yuboradi. */
export async function runOnce(nowMs = Date.now()): Promise<number> {
  const due = findDueTasks(nowMs);
  if (due.length === 0) return 0;

  log.info(`${due.length} ta eslatma yuborilmoqda`);
  let delivered = 0;

  for (const task of due) {
    try {
      await deliver(task);
      delivered += 1;
      log.debug(`yuborildi: id=${task.id} user=${task.user_id} "${task.title}"`);
    } catch (error) {
      if (isPermanentDeliveryFailure(error)) {
        log.warn(
          `yetkazib bo'lmadi (doimiy), vazifa yopildi: id=${task.id} user=${task.user_id}: ` +
            describeError(error),
        );
        setTaskStatus(task.id, task.user_id, "cancelled");
        continue;
      }

      // Vaqtinchalik xato — `notified_at` tegilmaydi, keyingi siklda qayta uriniladi.
      log.error(`yuborilmadi (vaqtinchalik): id=${task.id}: ${describeError(error)}`);
      continue;
    }

    // Yuborilgandan keyin holatni yangilaymiz.
    if (task.recurrence === "none") {
      markNotified(task.id, nowMs);
    } else {
      const next = advanceRecurring(task, nowMs);
      if (next !== null) {
        log.debug(`keyingi takrorlanish: id=${task.id} → ${formatUz(next, task.timezone)}`);
      } else {
        log.warn(`takrorlanish hisoblanmadi, seriya to'xtatildi: id=${task.id}`);
      }
    }
  }

  return delivered;
}

async function tick(): Promise<void> {
  if (running) {
    log.debug("oldingi sikl hali tugamadi, o'tkazib yuborildi");
    return;
  }

  running = true;
  try {
    await runOnce();
  } catch (error) {
    log.error(`sikl xatosi: ${describeError(error)}`);
  } finally {
    running = false;
  }
}

export function startScheduler(): void {
  if (timer) return;

  log.info(`ishga tushdi — har ${config.schedulerIntervalMs / 1000} sekundda tekshiriladi`);
  timer = setInterval(() => void tick(), config.schedulerIntervalMs);
  // Node'ni ushlab turmasin — to'xtatish `stopScheduler` orqali boshqariladi.
  timer.unref();

  // Ishga tushganda darhol bir marta tekshiramiz (server o'chib turgan payt o'tgan eslatmalar).
  void tick();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
  log.info("to'xtatildi");
}
