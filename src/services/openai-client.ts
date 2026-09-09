import OpenAI from "openai";
import { config } from "../config.js";

/**
 * Umumiy OpenAI mijozi — ham ovozni matnga o'girish (Whisper), ham matndan
 * vazifa/sana ajratish shu mijoz orqali ketadi.
 */
export const openai = new OpenAI({
  apiKey: config.openaiApiKey,
  maxRetries: 2,
  timeout: 120_000,
});
