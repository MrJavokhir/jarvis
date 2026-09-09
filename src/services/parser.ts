import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { createLogger, describeError } from "../lib/logger.js";
import { inZone, localToEpochMs, UZ_WEEKDAYS, type Recurrence } from "../lib/time.js";
import { openai } from "./openai-client.js";

const log = createLogger("parser");

/** Foydalanuvchiga ko'rsatish uchun o'zbekcha matni bor tahlil xatosi. */
export class ParserError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ParserError";
  }
}

const RECURRENCE_VALUES = ["none", "daily", "weekly", "monthly", "yearly"] as const;

// Structured outputs qat'iy sxema talab qiladi: barcha maydonlar majburiy va
// `additionalProperties: false`. Shuning uchun `.optional()` emas, `.nullable()`.
const ModelTaskSchema = z.object({
  title: z
    .string()
    .describe("Vazifaning qisqa nomi, o'zbek tilida. Sana/vaqt so'zlarini ichiga qo'shma."),
  notes: z.string().nullable().describe("Qo'shimcha tafsilot bo'lsa shu yerda, aks holda null."),
  date: z.string().describe("Eslatma sanasi, aniq YYYY-MM-DD formatida."),
  time: z.string().describe("Eslatma vaqti, aniq HH:mm formatida (24 soatlik)."),
  recurrence: z.enum(RECURRENCE_VALUES).describe("Takrorlanish. Aniq aytilmagan bo'lsa 'none'."),
  time_was_explicit: z
    .boolean()
    .describe("Foydalanuvchi aniq soatni aytgan bo'lsa true; vaqt taxmin qilingan bo'lsa false."),
});

const ModelResponseSchema = z.object({
  understood: z.boolean().describe("Hech bo'lmaganda bitta eslatma ajratilgan bo'lsa true."),
  reply: z
    .string()
    .describe(
      "understood=false bo'lsa foydalanuvchiga o'zbek tilida bir jumlalik tushuntirish " +
        "va misol. understood=true bo'lsa bo'sh satr.",
    ),
  tasks: z.array(ModelTaskSchema).describe("Ajratilgan eslatmalar ro'yxati."),
});

/** Tahlildan chiqqan, vaqti allaqachon hisoblangan eslatma. */
export interface ExtractedTask {
  title: string;
  notes: string | null;
  /** Eslatma vaqti, epoch ms UTC. */
  dueAt: number;
  recurrence: Recurrence;
  /** Foydalanuvchi aniq soatni aytganmi (false bo'lsa vaqt taxmin qilingan). */
  timeWasExplicit: boolean;
}

export interface ExtractTasksInput {
  text: string;
  timezone: string;
  /** Sinov uchun "hozir"ni qo'lda berish imkoniyati. */
  nowMs?: number;
}

export interface ExtractTasksResult {
  tasks: ExtractedTask[];
  /** Vazifa topilmaganda foydalanuvchiga ko'rsatiladigan izoh. */
  reply?: string;
}

const SYSTEM_PROMPT = `Sen o'zbek tilidagi eslatmalarni tahlil qiluvchi yordamchisan.

Foydalanuvchi ovozli yoki matnli xabarda vazifa va uning vaqtini aytadi.
Sening vazifang — undan aniq vazifa nomi va aniq sana/vaqtni ajratib olish.

QOIDALAR:

1. Sana va vaqtni HAR DOIM aniq qiymatga aylantir. "ertaga", "indinga",
   "keyingi dushanba", "2 soatdan keyin", "oyning oxirida" kabi nisbiy iboralarni
   foydalanuvchining hozirgi vaqtiga nisbatan hisobla.

2. Vaqt aytilmagan bo'lsa quyidagi taxminlarni ishlat va time_was_explicit=false qo'y:
   - "ertalab" → 08:00
   - "tushlik", "tush payti" → 13:00
   - "kunduzi" → 12:00
   - "kechqurun", "kechasi" → 20:00
   - hech qanday ishora yo'q → 09:00
   Aniq soat aytilgan bo'lsa (masalan "soat uchda", "15:30 da") time_was_explicit=true.

3. Sana aytilmagan, faqat soat aytilgan bo'lsa: agar bugun shu soat hali kelmagan
   bo'lsa — bugun, aks holda — ertaga.

4. Takrorlanish so'zlari: "har kuni"→daily, "har hafta"/"har dushanba"→weekly,
   "har oy"→monthly, "har yili"→yearly. Aniq aytilmasa 'none'.
   Takrorlanuvchi eslatmada date — birinchi takrorlanish sanasi bo'lsin.

5. title qisqa va aniq bo'lsin, sana/vaqt so'zlarini ichiga qo'shma.
   Masalan "ertaga soat 3 da shifokorga borish" → title: "Shifokorga borish".

6. Bitta xabarda bir nechta eslatma bo'lsa, hammasini alohida element qil.

7. Xabarda umuman vazifa yoki vaqt bo'lmasa (salomlashish, tushunarsiz gap,
   bo'sh transkripsiya): understood=false, tasks=[] va reply ichida o'zbek tilida
   bir jumlalik tushuntirish yoz — nima aytish kerakligini misol bilan ko'rsat.

8. Vazifa aniq, lekin vaqt umuman aytilmagan bo'lsa ham understood=true qil va
   2-qoidadagi standart vaqtni ishlat.

Sana hisoblashda xato qilmaslik uchun avval bugungi sanani va hafta kunini
e'tiborga ol, keyin nisbiy iborani unga qo'sh.`;

function buildUserPrompt(text: string, timezone: string, nowMs: number): string {
  const now = inZone(nowMs, timezone);
  const weekday = UZ_WEEKDAYS[now.weekday - 1] ?? "";

  return [
    `Foydalanuvchining hozirgi vaqti: ${now.toFormat("yyyy-MM-dd HH:mm")} (${weekday}), mintaqa: ${timezone}.`,
    ``,
    `Xabar matni:`,
    `"""`,
    text,
    `"""`,
  ].join("\n");
}

const TITLE_MAX = 120;
const INPUT_MAX = 4000;

const DEFAULT_HINT =
  "Eslatma topilmadi. Masalan shunday ayting: <i>«ertaga soat to'qqizda shifokorga borishni eslat»</i>";

/**
 * Matndan eslatmalarni ajratib oladi.
 *
 * OpenAI structured outputs ishlatiladi — model javobi sxemaga qat'iy mos
 * kelishi kafolatlanadi, shuning uchun qo'lda JSON tozalash kerak emas.
 */
export async function extractTasks(input: ExtractTasksInput): Promise<ExtractTasksResult> {
  const text = input.text.trim().slice(0, INPUT_MAX);
  if (!text) return { tasks: [], reply: DEFAULT_HINT };

  const nowMs = input.nowMs ?? Date.now();
  const startedAt = Date.now();

  let completion;
  try {
    completion = await openai.chat.completions.parse({
      model: config.parserModel,
      // Sana hisoblashda barqarorlik muhim — tasodifiylikni minimumga tushiramiz.
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(text, input.timezone, nowMs) },
      ],
      response_format: zodResponseFormat(ModelResponseSchema, "eslatmalar"),
    });
  } catch (error) {
    log.error(`tahlil so'rovi muvaffaqiyatsiz: ${describeError(error)}`);

    if (error instanceof OpenAI.AuthenticationError) {
      throw new ParserError("OpenAI auth xatosi", "Tahlil xizmati sozlanmagan (API kaliti noto'g'ri).", {
        cause: error,
      });
    }
    if (error instanceof OpenAI.PermissionDeniedError) {
      throw new ParserError(
        `model ruxsati yo'q: ${config.parserModel}`,
        `Tahlil modeliga (${config.parserModel}) ruxsat yo'q. ` +
          `OpenAI loyihangizda shu modelni yoqing yoki PARSER_MODEL ni o'zgartiring.`,
        { cause: error },
      );
    }
    if (error instanceof OpenAI.RateLimitError) {
      throw new ParserError("OpenAI rate limit", "Xizmat hozir band. Bir daqiqadan so'ng urinib ko'ring.", {
        cause: error,
      });
    }
    if (error instanceof OpenAI.APIConnectionError) {
      throw new ParserError("OpenAI ulanish xatosi", "Tahlil xizmatiga ulanib bo'lmadi. Qaytadan urinib ko'ring.", {
        cause: error,
      });
    }
    throw new ParserError("tahlil muvaffaqiyatsiz", "Xabarni tahlil qilishda xatolik yuz berdi.", {
      cause: error,
    });
  }

  const message = completion.choices[0]?.message;

  if (message?.refusal) {
    log.warn(`model so'rovni rad etdi: ${message.refusal}`);
    return { tasks: [], reply: "Bu xabarni qayta ishlay olmadim. Boshqacha ifodalab ko'ring." };
  }

  const parsed = message?.parsed;
  if (!parsed) {
    log.warn(`javobni sxema bo'yicha o'qib bo'lmadi (finish=${completion.choices[0]?.finish_reason})`);
    return { tasks: [], reply: DEFAULT_HINT };
  }

  const tasks: ExtractedTask[] = [];

  for (const item of parsed.tasks) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !/^\d{2}:\d{2}$/.test(item.time)) {
      log.warn(`sana/vaqt noto'g'ri formatda, tashlab ketildi: "${item.date} ${item.time}"`);
      continue;
    }

    const dueAt = localToEpochMs(item.date, item.time, input.timezone);
    if (dueAt === null) {
      log.warn(`sana/vaqtni vaqt belgisiga aylantirib bo'lmadi: "${item.date} ${item.time}"`);
      continue;
    }

    const title = item.title.trim().slice(0, TITLE_MAX);
    if (!title) continue;

    tasks.push({
      title,
      notes: item.notes?.trim() || null,
      dueAt,
      recurrence: item.recurrence,
      timeWasExplicit: item.time_was_explicit,
    });
  }

  log.info(
    `tahlil tayyor (${Date.now() - startedAt}ms): ${tasks.length} ta eslatma, model=${completion.model}`,
  );

  // Model "tushundim" desa-yu, birorta ham yaroqli sana chiqmasa — tushunmagan hisoblaymiz.
  if (tasks.length === 0) {
    return { tasks: [], reply: parsed.reply?.trim() || DEFAULT_HINT };
  }

  return { tasks };
}
