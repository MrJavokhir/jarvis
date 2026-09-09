import type { TaskRow } from "../db/tasks.js";
import type { ExtractedTask } from "../services/parser.js";
import { formatUz, humanizeUntil, RECURRENCE_LABELS_UZ } from "../lib/time.js";

/** Telegram HTML parse_mode uchun xavfsiz qilish. */
export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SOURCE_ICON: Record<TaskRow["source"], string> = {
  voice: "🎤",
  text: "💬",
  manual: "✍️",
};

/** Yangi saqlangan vazifa uchun tasdiq kartochkasi. */
export function newTaskCard(task: TaskRow, taskWasGuessed: boolean): string {
  const lines = [
    `✅ <b>Eslatma saqlandi</b>`,
    ``,
    `${SOURCE_ICON[task.source]} <b>${esc(task.title)}</b>`,
    `🗓 ${esc(formatUz(task.due_at, task.timezone))}`,
    `⏳ ${esc(humanizeUntil(task.due_at))}`,
  ];

  if (task.recurrence !== "none") {
    lines.push(`🔁 ${RECURRENCE_LABELS_UZ[task.recurrence]}`);
  }
  if (task.notes) {
    lines.push(`📝 ${esc(task.notes)}`);
  }
  if (taskWasGuessed) {
    lines.push(``, `<i>Soat aytilmagani uchun taxminiy vaqt qo'yildi — kerak bo'lsa o'zgartiring.</i>`);
  }

  return lines.join("\n");
}

/** Eslatma vaqti kelganda yuboriladigan xabar. */
export function reminderMessage(task: TaskRow, occurrenceAt: number): string {
  const lines = [
    `🔔 <b>ESLATMA</b>`,
    ``,
    `<b>${esc(task.title)}</b>`,
    `🕐 ${esc(formatUz(occurrenceAt, task.timezone))}`,
  ];

  if (task.recurrence !== "none") {
    lines.push(`🔁 ${RECURRENCE_LABELS_UZ[task.recurrence]}`);
  }
  if (task.notes) {
    lines.push(``, `📝 ${esc(task.notes)}`);
  }

  return lines.join("\n");
}

/** Yaqinlashib kelayotgan vazifalar ro'yxati. */
export function upcomingList(tasks: readonly TaskRow[]): string {
  if (tasks.length === 0) {
    return [
      "📭 Hozircha faol eslatma yo'q.",
      "",
      "Ovozli xabar yuboring — masalan: <i>«ertaga soat to'qqizda shifokorga borishni eslat»</i>",
    ].join("\n");
  }

  const lines = [`📋 <b>Yaqin eslatmalar</b>`, ``];

  for (const [index, task] of tasks.entries()) {
    const repeat = task.recurrence === "none" ? "" : ` 🔁 ${RECURRENCE_LABELS_UZ[task.recurrence]}`;
    lines.push(
      `<b>${index + 1}.</b> ${esc(task.title)}${repeat}`,
      `    🗓 ${esc(formatUz(task.due_at, task.timezone))} — <i>${esc(humanizeUntil(task.due_at))}</i>`,
    );
    if (task.notes) lines.push(`    📝 ${esc(task.notes)}`);
    lines.push(``);
  }

  return lines.join("\n").trimEnd();
}

/** Ovozdan olingan matnni ko'rsatish — foydalanuvchi to'g'ri tushunilganini tekshirsin. */
export function transcriptNote(transcript: string): string {
  return `🎤 <i>Eshitildi:</i> «${esc(transcript.slice(0, 500))}»`;
}

/** Bir nechta vazifa bir xabardan chiqqanida sarlavha. */
export function multiTaskHeader(count: number): string {
  return `✅ <b>${count} ta eslatma saqlandi</b>`;
}

export function extractedPreview(task: ExtractedTask, timezone: string): string {
  const repeat = task.recurrence === "none" ? "" : ` 🔁 ${RECURRENCE_LABELS_UZ[task.recurrence]}`;
  return `• <b>${esc(task.title)}</b>${repeat}\n    🗓 ${esc(formatUz(task.dueAt, timezone))}`;
}
