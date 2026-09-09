import type { Context } from "grammy";
import { GrammyError, type InlineKeyboard } from "grammy";
import { createLogger, describeError } from "../lib/logger.js";

const log = createLogger("bot:status");

/**
 * Bir xabarni bosqichma-bosqich tahrirlab boruvchi "holat" xabari.
 * Ovoz → matn → tahlil → natija oqimida foydalanuvchi nima bo'layotganini ko'rib turadi.
 */
export interface StatusHandle {
  update(html: string, keyboard?: InlineKeyboard): Promise<void>;
}

export async function createStatus(ctx: Context, initialHtml: string): Promise<StatusHandle> {
  let messageId: number | undefined;

  try {
    const sent = await ctx.reply(initialHtml, { parse_mode: "HTML" });
    messageId = sent.message_id;
  } catch (error) {
    log.warn(`holat xabari yuborilmadi: ${describeError(error)}`);
  }

  return {
    async update(html, keyboard) {
      const markup = keyboard ? { reply_markup: keyboard } : {};

      if (messageId !== undefined) {
        try {
          await ctx.api.editMessageText(ctx.chat!.id, messageId, html, {
            parse_mode: "HTML",
            ...markup,
          });
          return;
        } catch (error) {
          // "message is not modified" — bir xil matn qayta yuborilgan, muammo emas.
          if (error instanceof GrammyError && error.description.includes("is not modified")) {
            return;
          }
          log.warn(`holat xabari tahrirlanmadi: ${describeError(error)}`);
          messageId = undefined;
        }
      }

      await ctx.reply(html, { parse_mode: "HTML", ...markup });
    },
  };
}
