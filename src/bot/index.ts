import { Bot, GrammyError, HttpError } from "grammy";
import { config } from "../config.js";
import { createLogger, describeError } from "../lib/logger.js";
import { listUpcoming } from "../db/tasks.js";
import { setUserTimezone, upsertUser, userTimezone } from "../db/users.js";
import { esc, upcomingList } from "./format.js";
import { mainInlineKeyboard, mainReplyKeyboard, webAppUrl } from "./keyboards.js";
import { handleCallback } from "./handlers/callbacks.js";
import { handleVoice } from "./handlers/voice.js";
import { createTasksFromText } from "./handlers/create.js";
import { normalizeTimezone } from "../lib/time.js";
import { IANAZone } from "luxon";

const log = createLogger("bot");

export const bot = new Bot(config.telegramBotToken);

const HELP_TEXT = [
  "🤖 <b>Jarvis — ovozli eslatma boti</b>",
  "",
  "<b>Qanday ishlaydi:</b>",
  "1️⃣ Menga ovozli xabar yuboring — masalan:",
  "    <i>«Ertaga soat to'qqizda shifokorga borishni eslat»</i>",
  "2️⃣ Men ovozni matnga o'giraman va vazifa bilan sanani ajratib olaman",
  "3️⃣ Aytilgan vaqtda sizga bildirishnoma yuboraman",
  "",
  "Matn yozib yuborsangiz ham ishlaydi.",
  "",
  "<b>Nimalarni tushunaman:</b>",
  "• <i>bugun, ertaga, indinga, kelasi hafta</i>",
  "• <i>dushanba kuni, 15-sentabr, 2 soatdan keyin</i>",
  "• <i>ertalab, tushda, kechqurun</i> — soat aytilmasa taxmin qilaman",
  "• <i>har kuni, har hafta, har oy</i> — takrorlanuvchi eslatmalar",
  "",
  "<b>Buyruqlar:</b>",
  "/start — boshlash",
  "/vazifalar — yaqin eslatmalar ro'yxati",
  "/kalendar — kalendarni ochish (Mini App)",
  "/vaqt — vaqt mintaqasini o'zgartirish",
  "/yordam — shu yo'riqnoma",
].join("\n");

/** Har bir yangilanishda foydalanuvchi profilini yangilab turamiz. */
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    upsertUser({
      telegramId: ctx.from.id,
      firstName: ctx.from.first_name,
      username: ctx.from.username ?? null,
      languageCode: ctx.from.language_code ?? null,
    });
  }
  await next();
});

bot.command("start", async (ctx) => {
  const name = ctx.from?.first_name ? `, ${esc(ctx.from.first_name)}` : "";
  const zone = ctx.from ? userTimezone(ctx.from.id) : config.defaultTimezone;

  const lines = [
    `👋 Assalomu alaykum${name}!`,
    "",
    "Men <b>Jarvis</b> — ovozli eslatma botingizman.",
    "",
    "🎤 Menga ovozli xabar yuboring, masalan:",
    "<i>«Ertaga soat to'qqizda shifokorga borishni eslat»</i>",
    "",
    "Men aytilgan vaqtda sizni ogohlantiraman.",
    "",
    `🌍 Vaqt mintaqangiz: <b>${esc(zone)}</b>`,
  ];

  if (!webAppUrl("/")) {
    lines.push(
      "",
      "<i>ℹ️ Kalendar (Mini App) hozir ulanmagan — server PUBLIC_URL sozlanishini kutmoqda.</i>",
    );
  }

  await ctx.reply(lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: mainReplyKeyboard(),
  });

  const inline = mainInlineKeyboard();
  if (inline) {
    await ctx.reply("Barcha eslatmalarni kalendarda ko'rish uchun:", { reply_markup: inline });
  }
});

bot.command(["yordam", "help"], async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
});

bot.command(["vazifalar", "list", "eslatmalar"], async (ctx) => {
  if (!ctx.from) return;
  const tasks = listUpcoming(ctx.from.id, 10);
  await ctx.reply(upcomingList(tasks), {
    parse_mode: "HTML",
    reply_markup: mainInlineKeyboard(),
  });
});

bot.command(["kalendar", "calendar", "app"], async (ctx) => {
  const inline = mainInlineKeyboard();
  if (!inline) {
    await ctx.reply(
      "⚠️ Kalendar hozir mavjud emas — serverda <code>PUBLIC_URL</code> sozlanmagan.",
      { parse_mode: "HTML" },
    );
    return;
  }
  await ctx.reply("🗓 Kalendarni ochish:", { reply_markup: inline });
});

bot.command(["vaqt", "timezone", "tz"], async (ctx) => {
  if (!ctx.from) return;

  const argument = ctx.match.trim();
  const current = userTimezone(ctx.from.id);

  if (!argument) {
    await ctx.reply(
      [
        `🌍 Joriy vaqt mintaqasi: <b>${esc(current)}</b>`,
        "",
        "O'zgartirish uchun mintaqa nomini yuboring, masalan:",
        "<code>/vaqt Asia/Tashkent</code>",
        "<code>/vaqt Europe/Moscow</code>",
        "<code>/vaqt Asia/Dubai</code>",
      ].join("\n"),
      { parse_mode: "HTML" },
    );
    return;
  }

  if (!IANAZone.isValidZone(argument)) {
    await ctx.reply(
      `⚠️ <b>${esc(argument)}</b> — noto'g'ri mintaqa nomi.\n\n` +
        `To'g'ri shakl: <code>Asia/Tashkent</code>, <code>Europe/Moscow</code>.`,
      { parse_mode: "HTML" },
    );
    return;
  }

  const applied = setUserTimezone(ctx.from.id, normalizeTimezone(argument, config.defaultTimezone));
  await ctx.reply(`✅ Vaqt mintaqasi o'zgartirildi: <b>${esc(applied)}</b>`, {
    parse_mode: "HTML",
  });
});

bot.on(["message:voice", "message:audio", "message:video_note"], handleVoice);

bot.on("message:document", async (ctx, next) => {
  if (ctx.message.document.mime_type?.startsWith("audio/")) {
    await handleVoice(ctx);
    return;
  }
  await next();
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  // Pastdagi doimiy klaviatura tugmalari
  if (text === "📋 Eslatmalarim") {
    const tasks = listUpcoming(ctx.from.id, 10);
    await ctx.reply(upcomingList(tasks), {
      parse_mode: "HTML",
      reply_markup: mainInlineKeyboard(),
    });
    return;
  }

  if (text === "❓ Yordam") {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML", reply_markup: mainInlineKeyboard() });
    return;
  }

  await createTasksFromText({
    ctx,
    userId: ctx.from.id,
    text,
    source: "text",
  });
});

bot.on("callback_query:data", handleCallback);

bot.catch((err) => {
  const { error, ctx } = err;
  const from = ctx.from?.id ?? "?";

  if (error instanceof GrammyError) {
    log.error(`Telegram API xatosi (user=${from}): ${error.description}`);
  } else if (error instanceof HttpError) {
    log.error(`Telegram bilan aloqa uzildi (user=${from}): ${describeError(error)}`);
  } else {
    log.error(`Kutilmagan xato (user=${from}): ${describeError(error)}`);
  }
});

/** Buyruqlar ro'yxati va Mini App menyu tugmasini Telegramda ro'yxatdan o'tkazadi. */
export async function registerBotMetadata(): Promise<void> {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "Botni boshlash" },
      { command: "vazifalar", description: "Yaqin eslatmalar" },
      { command: "kalendar", description: "Kalendarni ochish" },
      { command: "vaqt", description: "Vaqt mintaqasi" },
      { command: "yordam", description: "Yo'riqnoma" },
    ]);

    const url = webAppUrl("/");
    if (url) {
      await bot.api.setChatMenuButton({
        menu_button: { type: "web_app", text: "🗓 Kalendar", web_app: { url } },
      });
      log.info(`menyu tugmasi Mini App'ga ulandi: ${url}`);
    } else {
      await bot.api.setChatMenuButton({ menu_button: { type: "commands" } });
      log.warn("PUBLIC_URL yo'q — Mini App menyu tugmasi o'rnatilmadi");
    }
  } catch (error) {
    log.warn(`bot metama'lumotlari o'rnatilmadi: ${describeError(error)}`);
  }
}
