import OpenAI, { toFile } from "openai";
import { config } from "../config.js";
import { createLogger, describeError } from "../lib/logger.js";
import { openai } from "./openai-client.js";

const log = createLogger("stt");

/** Foydalanuvchiga ko'rsatish uchun o'zbekcha matni bor STT xatosi. */
export class SttError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SttError";
  }
}

export interface TranscribeVoiceInput {
  /** `getFile` qaytargan `file_path`. */
  filePath: string;
  mimeType?: string | undefined;
  durationSeconds?: number | undefined;
  fileName?: string | undefined;
}

/** Telegram fayl serverida 20 MB cheklovi bor; undan kattasini yuklab o'tirmaymiz. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/oga": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "video/mp4": "mp4",
};

/**
 * Whisper fayl kengaytmasiga qarab formatni aniqlaydi, shuning uchun
 * nomni to'g'ri tanlash muhim. Telegram `file_path` odatda kengaytma bilan keladi.
 */
function resolveFileName(input: TranscribeVoiceInput): string {
  if (input.fileName && /\.[a-z0-9]{2,5}$/i.test(input.fileName)) return input.fileName;

  const fromPath = input.filePath.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromPath) return `voice.${fromPath === "oga" ? "ogg" : fromPath}`;

  const fromMime = input.mimeType ? MIME_EXTENSIONS[input.mimeType.toLowerCase()] : undefined;
  return `voice.${fromMime ?? "ogg"}`;
}

async function downloadFromTelegram(filePath: string): Promise<Buffer> {
  const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new SttError("Telegram fayl serveriga ulanib bo'lmadi", "Ovozli faylni yuklab bo'lmadi. Qaytadan yuboring.", {
      cause: error,
    });
  }

  if (!response.ok) {
    throw new SttError(
      `Telegram fayl javobi ${response.status}`,
      "Ovozli faylni Telegramdan olib bo'lmadi. Qaytadan yuboring.",
    );
  }

  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_AUDIO_BYTES) {
    throw new SttError(`fayl juda katta: ${declaredSize} bayt`, "Ovozli xabar juda katta.");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new SttError("bo'sh fayl", "Ovozli fayl bo'sh keldi. Qaytadan yuboring.");
  }
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new SttError(`fayl juda katta: ${buffer.byteLength} bayt`, "Ovozli xabar juda katta.");
  }

  return buffer;
}

/**
 * Telegram ovozli xabarini matnga o'giradi.
 *
 * Telegram OGG/Opus yuboradi — Whisper uni to'g'ridan-to'g'ri qabul qiladi,
 * shuning uchun ffmpeg bilan qayta kodlash shart emas.
 */
export async function transcribeVoice(input: TranscribeVoiceInput): Promise<string> {
  const startedAt = Date.now();
  const audio = await downloadFromTelegram(input.filePath);
  const fileName = resolveFileName(input);

  let text: string;
  try {
    const file = await toFile(audio, fileName);

    const result = await openai.audio.transcriptions.create({
      file,
      model: config.sttModel,
      // O'zbek tilini aniq ko'rsatamiz — aks holda qo'shni tillar bilan adashtirishi mumkin.
      language: "uz",
      prompt:
        "Bu o'zbek tilidagi eslatma. Vazifa, sana va vaqt aytiladi. " +
        "Masalan: ertaga soat uchda shifokorga borish.",
      response_format: "text",
    });

    // `response_format: "text"` da API oddiy matn qaytaradi, lekin SDK tiplari
    // obyekt shaklini ham qamrab oladi — ikkalasini ham qo'llab-quvvatlaymiz.
    text = (typeof result === "string" ? result : ((result as { text?: string }).text ?? "")).trim();
  } catch (error) {
    log.error(`transkripsiya xatosi: ${describeError(error)}`);

    if (error instanceof OpenAI.AuthenticationError) {
      throw new SttError("OpenAI auth xatosi", "Ovoz xizmati sozlanmagan (API kalit noto'g'ri).", {
        cause: error,
      });
    }
    if (error instanceof OpenAI.PermissionDeniedError) {
      throw new SttError(
        `model ruxsati yo'q: ${config.sttModel}`,
        `Ovoz modeliga (${config.sttModel}) ruxsat yo'q. OpenAI loyihangizda shu modelni ` +
          `yoqing yoki STT_MODEL ni whisper-1 ga o'zgartiring.`,
        { cause: error },
      );
    }
    if (error instanceof OpenAI.RateLimitError) {
      throw new SttError("OpenAI rate limit", "Xizmat hozir band. Bir daqiqadan so'ng urinib ko'ring.", {
        cause: error,
      });
    }
    throw new SttError("transkripsiya muvaffaqiyatsiz", "Ovozni matnga o'girib bo'lmadi. Qaytadan urinib ko'ring.", {
      cause: error,
    });
  }

  log.info(
    `transkripsiya tayyor (${Date.now() - startedAt}ms, ${audio.byteLength} bayt → ${text.length} belgi)`,
  );

  if (!text) {
    throw new SttError(
      "bo'sh transkripsiya",
      "Ovozli xabardan matn chiqmadi. Iltimos, tinchroq joyda qaytadan aytib ko'ring.",
    );
  }

  return text;
}
