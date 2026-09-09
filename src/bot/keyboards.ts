import { InlineKeyboard, Keyboard } from "grammy";
import { config } from "../config.js";
import type { TaskRow } from "../db/tasks.js";

/** Callback data 64 baytdan oshmasligi kerak — shuning uchun kalitlar qisqa. */
export const CB = {
  done: "d",
  snooze: "s",
  remove: "x",
  open: "o",
} as const;

export function encodeDone(taskId: number, occurrenceAt: number): string {
  return `${CB.done}:${taskId}:${occurrenceAt}`;
}

export function encodeSnooze(taskId: number, minutes: number): string {
  return `${CB.snooze}:${taskId}:${minutes}`;
}

export function encodeRemove(taskId: number): string {
  return `${CB.remove}:${taskId}`;
}

/** Mini App manzili; `PUBLIC_URL` bo'lmasa `null`. */
export function webAppUrl(path = "/"): string | null {
  if (!config.publicUrl) return null;
  return `${config.publicUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Eslatma xabari ostidagi tugmalar. */
export function reminderKeyboard(task: TaskRow, occurrenceAt: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✅ Bajarildi", encodeDone(task.id, occurrenceAt))
    .row()
    .text("⏰ 10 daq", encodeSnooze(task.id, 10))
    .text("⏰ 1 soat", encodeSnooze(task.id, 60))
    .text("⏰ Ertaga", encodeSnooze(task.id, 60 * 24));

  const url = webAppUrl(`/?taskId=${task.id}`);
  if (url) kb.row().webApp("🗓 Kalendarda ko'rish", url);

  return kb;
}

/** Yangi saqlangan vazifa ostidagi tugmalar. */
export function newTaskKeyboard(task: TaskRow): InlineKeyboard {
  const kb = new InlineKeyboard();

  const url = webAppUrl(`/?taskId=${task.id}`);
  if (url) kb.webApp("✏️ O'zgartirish", url).row();

  kb.text("🗑 O'chirish", encodeRemove(task.id));
  return kb;
}

/** /start va /help ostidagi asosiy tugmalar. */
export function mainInlineKeyboard(): InlineKeyboard | undefined {
  const url = webAppUrl("/");
  if (!url) return undefined;
  return new InlineKeyboard().webApp("🗓 Kalendarni ochish", url);
}

/**
 * Doimiy pastdagi klaviatura. Mini App tugmasi faqat HTTPS manzil
 * mavjud bo'lganda qo'shiladi (Telegram talabi).
 */
export function mainReplyKeyboard(): Keyboard {
  const kb = new Keyboard();
  const url = webAppUrl("/");

  if (url) kb.webApp("🗓 Kalendar", url).row();

  return kb.text("📋 Eslatmalarim").text("❓ Yordam").resized();
}
