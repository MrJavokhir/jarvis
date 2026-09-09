import type { Context } from "grammy";
import { config } from "../../config.js";
import { createLogger, describeError } from "../../lib/logger.js";
import { SttError, transcribeVoice } from "../../services/stt.js";
import { createStatus } from "../status.js";
import { createTasksFromText } from "./create.js";

const log = createLogger("bot:voice");

/** Xabardan audio bo'lagini ajratib oladi (voice / audio / audio-document). */
function pickAudio(ctx: Context):
  | { fileId: string; mimeType?: string | undefined; duration?: number | undefined; fileName?: string | undefined }
  | null {
  const msg = ctx.message;
  if (!msg) return null;

  if (msg.voice) {
    return {
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type ?? "audio/ogg",
      duration: msg.voice.duration,
    };
  }

  if (msg.audio) {
    return {
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type ?? undefined,
      duration: msg.audio.duration,
      fileName: msg.audio.file_name ?? undefined,
    };
  }

  if (msg.video_note) {
    return { fileId: msg.video_note.file_id, mimeType: "video/mp4", duration: msg.video_note.duration };
  }

  if (msg.document?.mime_type?.startsWith("audio/")) {
    return {
      fileId: msg.document.file_id,
      mimeType: msg.document.mime_type,
      fileName: msg.document.file_name ?? undefined,
    };
  }

  return null;
}

export async function handleVoice(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const audio = pickAudio(ctx);
  if (!audio) return;

  if (audio.duration !== undefined && audio.duration > config.maxVoiceDurationSeconds) {
    await ctx.reply(
      `⚠️ Ovozli xabar juda uzun (${audio.duration} sekund). ` +
        `Eng ko'pi ${config.maxVoiceDurationSeconds} sekund bo'lishi kerak.`,
    );
    return;
  }

  const status = await createStatus(ctx, "🎤 <i>Ovoz tinglanmoqda…</i>");

  let transcript: string;
  try {
    const file = await ctx.api.getFile(audio.fileId);
    if (!file.file_path) {
      await status.update("⚠️ Ovozli faylni Telegramdan olib bo'lmadi. Qaytadan yuboring.");
      return;
    }

    transcript = await transcribeVoice({
      filePath: file.file_path,
      mimeType: audio.mimeType,
      durationSeconds: audio.duration,
      ...(audio.fileName ? { fileName: audio.fileName } : {}),
    });
  } catch (error) {
    if (error instanceof SttError) {
      log.warn(`STT xatosi: ${error.message}`);
      await status.update(`⚠️ ${error.userMessage}`);
      return;
    }
    log.error(`ovoz qayta ishlanmadi: ${describeError(error)}`);
    await status.update("⚠️ Ovozli xabarni qayta ishlashda xatolik yuz berdi. Qaytadan urinib ko'ring.");
    return;
  }

  await createTasksFromText({
    ctx,
    userId,
    text: transcript,
    source: "voice",
    transcript,
    status,
  });
}
