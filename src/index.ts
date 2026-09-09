import { config } from "./config.js";
import { createLogger, describeError } from "./lib/logger.js";
import { bot, registerBotMetadata } from "./bot/index.js";
import { createServer, startServer } from "./web/server.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { closeDb } from "./db/index.js";

const log = createLogger("main");

async function main(): Promise<void> {
  log.info(`Jarvis ishga tushmoqda — rejim: ${config.botMode}`);

  const app = await createServer();
  await startServer(app);

  const me = await bot.api.getMe();
  log.info(`bot ulandi: @${me.username} (id=${me.id})`);

  await registerBotMetadata();

  if (config.botMode === "webhook") {
    const webhookUrl = `${config.publicUrl}${config.webhookPath}`;
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.webhookSecret,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query"],
    });
    log.info(`webhook o'rnatildi: ${webhookUrl}`);
    // Webhook rejimida `bot.init()` kerak — `bot.start()` chaqirilmaydi.
    await bot.init();
  } else {
    // Long polling: eski webhook qolib ketmasin.
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    void bot.start({
      allowed_updates: ["message", "callback_query"],
      onStart: (info) => log.info(`long polling boshlandi: @${info.username}`),
    });
  }

  startScheduler();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} qabul qilindi — to'xtatilmoqda`);

    stopScheduler();

    try {
      if (config.botMode === "polling") await bot.stop();
    } catch (error) {
      log.warn(`bot to'xtatilmadi: ${describeError(error)}`);
    }

    try {
      await app.close();
    } catch (error) {
      log.warn(`server yopilmadi: ${describeError(error)}`);
    }

    closeDb();
    log.info("to'xtatildi");
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    log.error(`ushlanmagan rejection: ${describeError(reason)}`);
  });
  process.on("uncaughtException", (error) => {
    log.error(`ushlanmagan exception: ${describeError(error)}`);
  });

  log.info("Jarvis tayyor ✅");
}

main().catch((error) => {
  log.error(`ishga tushirish muvaffaqiyatsiz: ${describeError(error)}`);
  process.exit(1);
});
