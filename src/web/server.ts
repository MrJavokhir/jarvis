import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { webhookCallback } from "grammy";
import { bot } from "../bot/index.js";
import { config } from "../config.js";
import { createLogger, describeError } from "../lib/logger.js";
import { registerApiRoutes } from "./routes.js";

const log = createLogger("web");

// ESM'da `__dirname` yo'q — skript joyini `import.meta.url`dan olamiz.
const here = path.dirname(fileURLToPath(import.meta.url));
/** `dist/web/` → loyiha ildizi. Dev rejimida `src/web/` → ildiz. */
const projectRoot = path.resolve(here, "..", "..");
const webappDist = path.join(projectRoot, "webapp", "dist");

export async function createServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // Telegram webhook so'rovlari kichik; katta tanani qabul qilishning hojati yo'q.
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  app.get("/health", async () => ({
    ok: true,
    mode: config.botMode,
    time: new Date().toISOString(),
  }));

  registerApiRoutes(app);

  if (config.botMode === "webhook") {
    app.post(
      config.webhookPath,
      webhookCallback(bot, "fastify", {
        secretToken: config.webhookSecret,
        // Telegram 60 s kutadi; biz 50 s dan keyin javob qaytaramiz.
        onTimeout: "return",
        timeoutMilliseconds: 50_000,
      }),
    );
    log.info(`webhook endpoint: POST ${config.webhookPath}`);
  }

  const indexHtmlPath = path.join(webappDist, "index.html");
  const hasWebapp = fs.existsSync(indexHtmlPath);
  // SPA yo'nalishlarida har safar diskka bormaslik uchun bir marta o'qib qo'yamiz.
  const indexHtml = hasWebapp ? fs.readFileSync(indexHtmlPath) : null;

  if (hasWebapp) {
    await app.register(fastifyStatic, {
      root: webappDist,
      prefix: "/",
      index: ["index.html"],
      // Vite fayl nomiga hash qo'shadi — uzoq kesh xavfsiz.
      setHeaders(reply, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          reply.header("cache-control", "public, max-age=31536000, immutable");
        } else {
          reply.header("cache-control", "no-cache");
        }
      },
    });
    log.info(`Mini App fayllari: ${webappDist}`);
  } else {
    log.warn(
      `Mini App qurilmagan (${webappDist} topilmadi). ` +
        `\`npm run build:web\` buyrug'ini bajaring.`,
    );
  }

  /** SPA yo'nalishlari uchun index.html qaytaramiz; API va webhook chetlab o'tiladi. */
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method !== "GET" || request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Topilmadi" });
    }

    if (!indexHtml) {
      return reply
        .code(503)
        .type("text/plain; charset=utf-8")
        .send("Mini App hali qurilmagan. `npm run build:web` buyrug'ini bajaring.");
    }

    return reply.type("text/html; charset=utf-8").send(indexHtml);
  });

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    log.error(`${request.method} ${request.url} — ${describeError(error)}`);
    const status = typeof error.statusCode === "number" ? error.statusCode : 500;
    return reply.code(status >= 400 && status < 600 ? status : 500).send({ error: "Server xatosi" });
  });

  return app;
}

export async function startServer(app: FastifyInstance): Promise<void> {
  await app.listen({ port: config.port, host: config.host });
  log.info(`server tinglayapti: http://${config.host}:${config.port}`);
}
