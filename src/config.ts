import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";

/** Bo'sh satrni `undefined` deb qaraymiz — .env'da bo'sh qoldirilgan kalitlar defaultga tushsin. */
const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1, "TELEGRAM_BOT_TOKEN majburiy"),
  ANTHROPIC_API_KEY: z.string().trim().min(1, "ANTHROPIC_API_KEY majburiy"),
  OPENAI_API_KEY: z.string().trim().min(1, "OPENAI_API_KEY majburiy"),

  PUBLIC_URL: optionalString,
  BOT_MODE: z.enum(["polling", "webhook"]).optional(),
  TELEGRAM_WEBHOOK_SECRET: optionalString,

  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().trim().default("0.0.0.0"),

  DEFAULT_TIMEZONE: z.string().trim().default("Asia/Tashkent"),
  DATA_DIR: z.string().trim().default("./data"),

  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
  MAX_VOICE_DURATION_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),

  STT_MODEL: z.string().trim().default("gpt-4o-transcribe"),
  CLAUDE_MODEL: z.string().trim().default("claude-opus-5"),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".") || "(env)"}: ${i.message}`)
    .join("\n");
  console.error(
    `\n[config] Muhit o'zgaruvchilari to'liq emas:\n${issues}\n\n` +
      `.env.example faylidan nusxa olib .env yarating va kalitlarni to'ldiring.\n`,
  );
  process.exit(1);
}

const env = parsed.data;

/** Oxiridagi `/` ni olib tashlaymiz, keyin URL'larni qo'shganda ikkilanmasin. */
const publicUrl = env.PUBLIC_URL?.replace(/\/+$/, "");

const botMode: "polling" | "webhook" = env.BOT_MODE ?? (publicUrl ? "webhook" : "polling");

if (botMode === "webhook" && !publicUrl) {
  console.error("[config] BOT_MODE=webhook uchun PUBLIC_URL ham kerak.");
  process.exit(1);
}

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  openaiApiKey: env.OPENAI_API_KEY,

  publicUrl,
  botMode,
  /** Webhook maxfiy tokeni — berilmasa har ishga tushishda yangi generatsiya qilinadi. */
  webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? crypto.randomBytes(24).toString("hex"),
  webhookPath: "/telegram/webhook",

  port: env.PORT,
  host: env.HOST,

  defaultTimezone: env.DEFAULT_TIMEZONE,
  dataDir: path.resolve(env.DATA_DIR),

  schedulerIntervalMs: env.SCHEDULER_INTERVAL_SECONDS * 1000,
  maxVoiceDurationSeconds: env.MAX_VOICE_DURATION_SECONDS,

  sttModel: env.STT_MODEL,
  claudeModel: env.CLAUDE_MODEL,

  logLevel: env.LOG_LEVEL,
} as const;

export type Config = typeof config;
