// Jarvis bot uchun integratsion smoke-test: auth + API + kalendar + rejalashtiruvchi mantiqi.
// Tarmoqqa chiqmaydi — faqat lokal DB va Fastify `inject` ishlatiladi.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BOT_TOKEN = "123456:TEST-TOKEN-FOR-SMOKE-ONLY";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-smoke-"));

process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.ANTHROPIC_API_KEY = "sk-ant-test";
process.env.OPENAI_API_KEY = "sk-test";
process.env.DATA_DIR = dataDir;
process.env.BOT_MODE = "polling";
process.env.DEFAULT_TIMEZONE = "Asia/Tashkent";
process.env.LOG_LEVEL = "error";

import { fileURLToPath, pathToFileURL } from "node:url";

// `tests/` yonidagi `dist/` — avval `npm run build:server` bajarilgan bo'lishi kerak.
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, "..", "dist");

if (!fs.existsSync(path.join(DIST, "web", "server.js"))) {
  console.error("dist/ topilmadi. Avval `npm run build:server` buyrug'ini bajaring.");
  process.exit(1);
}

const load = (rel) => import(pathToFileURL(path.join(DIST, rel)).href);

const { createServer } = await load("web/server.js");
const tasksDb = await load("db/tasks.js");
const timeLib = await load("lib/time.js");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Telegram spetsifikatsiyasi bo'yicha haqiqiy initData yasaydi. */
function makeInitData(user, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({
    user: JSON.stringify(user),
    auth_date: String(authDate),
    query_id: "AAtest",
    // Telegram Bot API 8.0 dan beri `signature` doim yuboriladi. Bot tokeni
    // bilan HMAC tekshiruvida u imzo hisobiga KIRADI (faqat Ed25519 usulida
    // chiqariladi), shuning uchun testda ham bo'lishi shart.
    signature: "3-Xf9mZq_TestEd25519SignaturePlaceholder",
  });

  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = crypto.createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

const USER = { id: 424242, first_name: "Javohir", username: "mrjavokhir", language_code: "uz" };
const initData = makeInitData(USER);
const auth = { authorization: `tma ${initData}` };

const app = await createServer();
await app.ready();

const call = (method, url, payload) =>
  app.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

// ── Auth ────────────────────────────────────────────────
section("Autentifikatsiya");
{
  const noAuth = await app.inject({ method: "GET", url: "/api/bootstrap" });
  check("initData'siz so'rov rad etiladi", noAuth.statusCode === 401, `kod=${noAuth.statusCode}`);

  const tampered = initData.replace(/hash=[0-9a-f]+/, `hash=${"0".repeat(64)}`);
  const bad = await app.inject({
    method: "GET",
    url: "/api/bootstrap",
    headers: { authorization: `tma ${tampered}` },
  });
  check("soxta imzo rad etiladi", bad.statusCode === 401, `kod=${bad.statusCode}`);

  const expired = makeInitData(USER, Math.floor(Date.now() / 1000) - 48 * 3600);
  const old = await app.inject({
    method: "GET",
    url: "/api/bootstrap",
    headers: { authorization: `tma ${expired}` },
  });
  check("muddati o'tgan initData rad etiladi", old.statusCode === 401, `kod=${old.statusCode}`);

  const ok = await call("GET", "/api/bootstrap");
  const body = ok.json();
  check("haqiqiy initData qabul qilinadi", ok.statusCode === 200, `kod=${ok.statusCode}`);
  check("userId to'g'ri", body.userId === USER.id, `keldi=${body.userId}`);
  check("mintaqa standart qiymatda", body.timezone === "Asia/Tashkent", body.timezone);
}

// ── Vazifa yaratish ─────────────────────────────────────
section("Vazifa yaratish");

const tz = "Asia/Tashkent";
const nowParts = timeLib.epochMsToLocalParts(Date.now(), tz);
const [y, m] = nowParts.date.split("-").map(Number);
const monthPrefix = `${y}-${String(m).padStart(2, "0")}`;

let oneOffId;
let dailyId;

{
  const oneOff = await call("POST", "/api/tasks", {
    title: "Shifokorga borish",
    notes: "Pasport olib borish",
    date: `${monthPrefix}-15`,
    time: "14:30",
    recurrence: "none",
  });
  check("bir martalik vazifa yaratildi", oneOff.statusCode === 201, `kod=${oneOff.statusCode}`);
  oneOffId = oneOff.json().task?.id;
  check("qaytgan vaqt to'g'ri", oneOff.json().task?.time === "14:30", oneOff.json().task?.time);

  const daily = await call("POST", "/api/tasks", {
    title: "Dori ichish",
    notes: null,
    date: `${monthPrefix}-01`,
    time: "08:00",
    recurrence: "daily",
  });
  check("takrorlanuvchi vazifa yaratildi", daily.statusCode === 201, `kod=${daily.statusCode}`);
  dailyId = daily.json().task?.id;

  const bad = await call("POST", "/api/tasks", {
    title: "",
    notes: null,
    date: "notadate",
    time: "99:99",
    recurrence: "none",
  });
  check("noto'g'ri ma'lumot 400 qaytaradi", bad.statusCode === 400, `kod=${bad.statusCode}`);
}

// ── Kalendar ────────────────────────────────────────────
section("Kalendar (takrorlanishlarni yozish)");

const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
let dailyOccurrenceAt;

{
  const res = await call(
    "GET",
    `/api/occurrences?from=${monthPrefix}-01&to=${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`,
  );
  check("oraliq so'rovi ishladi", res.statusCode === 200, `kod=${res.statusCode}`);

  const list = res.json().occurrences;
  const daily = list.filter((o) => o.taskId === dailyId);
  const single = list.filter((o) => o.taskId === oneOffId);

  check(
    `kunlik vazifa ${daysInMonth} marta yozildi`,
    daily.length === daysInMonth,
    `keldi=${daily.length}`,
  );
  check("bir martalik vazifa bir marta", single.length === 1, `keldi=${single.length}`);
  check("kunlik vazifa vaqti saqlandi", daily.every((o) => o.time === "08:00"));
  check(
    "hodisalar vaqt bo'yicha saralangan",
    list.every((o, i) => i === 0 || list[i - 1].occurrenceAt <= o.occurrenceAt),
  );
  check("bir martalik vazifa sanasi to'g'ri", single[0]?.date === `${monthPrefix}-15`, single[0]?.date);

  dailyOccurrenceAt = daily[10]?.occurrenceAt;

  const badRange = await call("GET", "/api/occurrences?from=xxx&to=yyy");
  check("noto'g'ri oraliq 400", badRange.statusCode === 400, `kod=${badRange.statusCode}`);
}

// ── Bajarildi belgisi ───────────────────────────────────
section("Bajarilganlik");
{
  const done = await call("POST", `/api/tasks/${dailyId}/complete`, {
    occurrenceAt: dailyOccurrenceAt,
    completed: true,
  });
  check("takrorlanish bajarildi deb belgilandi", done.statusCode === 200, `kod=${done.statusCode}`);

  const res = await call(
    "GET",
    `/api/occurrences?from=${monthPrefix}-01&to=${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`,
  );
  const list = res.json().occurrences;
  const marked = list.filter((o) => o.taskId === dailyId && o.completed);
  check("faqat bitta takrorlanish belgilandi", marked.length === 1, `keldi=${marked.length}`);
  check(
    "belgilangan takrorlanish to'g'risi",
    marked[0]?.occurrenceAt === dailyOccurrenceAt,
  );

  const undone = await call("POST", `/api/tasks/${dailyId}/complete`, {
    occurrenceAt: dailyOccurrenceAt,
    completed: false,
  });
  check("belgi olib tashlandi", undone.statusCode === 200, `kod=${undone.statusCode}`);

  const after = await call(
    "GET",
    `/api/occurrences?from=${monthPrefix}-01&to=${monthPrefix}-${String(daysInMonth).padStart(2, "0")}`,
  );
  check(
    "belgi haqiqatan olib tashlandi",
    after.json().occurrences.filter((o) => o.taskId === dailyId && o.completed).length === 0,
  );
}

// ── Tahrirlash va o'chirish ─────────────────────────────
section("Tahrirlash va o'chirish");
{
  const patched = await call("PATCH", `/api/tasks/${oneOffId}`, {
    title: "Tish shifokoriga borish",
    time: "16:00",
  });
  check("vazifa tahrirlandi", patched.statusCode === 200, `kod=${patched.statusCode}`);
  check("yangi nom saqlandi", patched.json().task?.title === "Tish shifokoriga borish");
  check("yangi vaqt saqlandi", patched.json().task?.time === "16:00", patched.json().task?.time);

  const foreign = await app.inject({
    method: "PATCH",
    url: `/api/tasks/${oneOffId}`,
    headers: { authorization: `tma ${makeInitData({ id: 999999, first_name: "O'zga" })}` },
    payload: { title: "O'g'irlangan" },
  });
  check("boshqa foydalanuvchi tahrirlay olmaydi", foreign.statusCode === 404, `kod=${foreign.statusCode}`);

  const removed = await call("DELETE", `/api/tasks/${oneOffId}`);
  check("vazifa o'chirildi", removed.statusCode === 200 || removed.statusCode === 204, `kod=${removed.statusCode}`);

  const gone = await call("GET", `/api/tasks/${oneOffId}`);
  check("o'chirilgan vazifa topilmaydi", gone.statusCode === 404, `kod=${gone.statusCode}`);
}

// ── Rejalashtiruvchi mantiqi ────────────────────────────
section("Rejalashtiruvchi");
{
  const past = Date.now() - 60_000;
  const created = tasksDb.createTask({
    userId: USER.id,
    title: "O'tib ketgan vazifa",
    dueAt: past,
    timezone: tz,
    recurrence: "none",
    source: "manual",
  });

  const due = tasksDb.findDueTasks(Date.now());
  check("vaqti kelgan vazifa topildi", due.some((t) => t.id === created.id));

  tasksDb.markNotified(created.id);
  check(
    "xabar berilgandan keyin qayta chiqmaydi",
    !tasksDb.findDueTasks(Date.now()).some((t) => t.id === created.id),
  );

  const recurring = tasksDb.createTask({
    userId: USER.id,
    title: "Kunlik mashq",
    dueAt: past,
    timezone: tz,
    recurrence: "daily",
    source: "manual",
  });
  const next = tasksDb.advanceRecurring(recurring);
  check("takrorlanuvchi vazifa oldinga surildi", next !== null && next > Date.now(), `next=${next}`);

  const reloaded = tasksDb.getTask(recurring.id);
  check("yangi vaqt bazaga yozildi", reloaded?.due_at === next);
  check("xabar bayrog'i tozalandi", reloaded?.notified_at === null);
}

// ── Vaqt yordamchilari ──────────────────────────────────
section("Vaqt hisoblari");
{
  const base = timeLib.localToEpochMs("2026-03-10", "09:00", tz);
  check("mahalliy vaqt UTC'ga aylandi", typeof base === "number" && base > 0);

  const nextDaily = timeLib.nextOccurrence(base, "daily", tz, base);
  check("kunlik qadam +24 soat", nextDaily - base === 86_400_000, `farq=${nextDaily - base}`);

  const nextMonthly = timeLib.nextOccurrence(base, "monthly", tz, base);
  check(
    "oylik qadam mahalliy soatni saqladi",
    timeLib.epochMsToLocalParts(nextMonthly, tz).time === "09:00",
  );
  check(
    "oylik qadam keyingi oyga o'tdi",
    timeLib.epochMsToLocalParts(nextMonthly, tz).date === "2026-04-10",
    timeLib.epochMsToLocalParts(nextMonthly, tz).date,
  );

  // O'tkazib yuborilgan takrorlanishlar kelajakka yetguncha surilishi kerak.
  const skipped = timeLib.nextOccurrence(base, "daily", tz, base + 10 * 86_400_000);
  check("o'tkazib yuborilganlar kelajakka surildi", skipped > base + 10 * 86_400_000);

  check("formatlash o'zbekcha", timeLib.formatUz(base, tz).includes("mart"), timeLib.formatUz(base, tz));
  check("takrorlanmaydigan uchun null", timeLib.nextOccurrence(base, "none", tz, base) === null);
}

// ── Bot tugmalari (callback) ────────────────────────────
section("Bot tugmalari");

const { Context } = await import("grammy");
const { bot } = await load("bot/index.js");
const { handleCallback } = await load("bot/handlers/callbacks.js");

const apiCalls = [];
let failWith = null;

// Telegramga chiqmaymiz: barcha API chaqiruvlarini ushlab qolamiz.
bot.api.config.use(async (_prev, method, payload) => {
  apiCalls.push({ method, payload });

  if (failWith) {
    const error = failWith;
    failWith = null;
    return { ok: false, error_code: error.code, description: error.description };
  }

  if (method === "sendMessage" || method === "editMessageText") {
    return {
      ok: true,
      result: {
        message_id: 1,
        date: Math.floor(Date.now() / 1000),
        chat: { id: USER.id, type: "private" },
        text: payload.text ?? "",
      },
    };
  }

  return { ok: true, result: true };
});

const ME = {
  id: 1,
  is_bot: true,
  first_name: "Jarvis",
  username: "jarvis_test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business_account: false,
  has_main_web_app: false,
};

const makeCtx = (data, fromId = USER.id) =>
  new Context(
    {
      update_id: Math.floor(Math.random() * 1e6),
      callback_query: {
        id: "cbq1",
        from: { id: fromId, is_bot: false, first_name: "Javohir" },
        chat_instance: "ci",
        data,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: fromId, type: "private" },
          text: "ESLATMA\n\nDori ichish",
          entities: [{ type: "bold", offset: 0, length: 7 }],
        },
      },
    },
    bot.api,
    ME,
  );

const newTask = (title, dueAt, recurrence = "none") =>
  tasksDb.createTask({
    userId: USER.id,
    title,
    dueAt,
    timezone: tz,
    recurrence,
    source: "manual",
  });

// «Bajarildi» — bir martalik vazifa butunlay yopiladi
{
  const t = newTask("Bir martalik", Date.now() + 60_000);
  await handleCallback(makeCtx(`d:${t.id}:${t.due_at}`));
  check("bir martalik vazifa bajarildi deb yopildi", tasksDb.getTask(t.id)?.status === "done");
}

// «Bajarildi» — takrorlanuvchida faqat shu qadam yopiladi, seriya davom etadi
{
  const t = newTask("Kunlik", Date.now() + 60_000, "daily");
  await handleCallback(makeCtx(`d:${t.id}:${t.due_at}`));

  const after = tasksDb.getTask(t.id);
  check("takrorlanuvchi seriya ochiq qoldi", after?.status === "pending");
  check("seriya vaqti surilmadi", after?.due_at === t.due_at);
  check(
    "aynan shu qadam bajarilgan deb yozildi",
    tasksDb.completionsForTask(t.id).includes(t.due_at),
  );
}

// Xabarni tahrirlashda asl formatlash saqlanadi
{
  const edit = apiCalls.filter((c) => c.method === "editMessageText").pop();
  check("xabar tahrirlandi", Boolean(edit));
  check("asl formatlash entities orqali saqlandi", Array.isArray(edit?.payload?.entities));
  check("HTML sifatida qayta yuborilmadi", edit?.payload?.parse_mode === undefined);
  check("tugmalar olib tashlandi", edit?.payload?.reply_markup === undefined);
}

// «Keyinroq» — bir martalik vazifa suriladi
{
  const t = newTask("Suriladigan", Date.now() - 60_000);
  tasksDb.markNotified(t.id);
  await handleCallback(makeCtx(`s:${t.id}:10`));

  const after = tasksDb.getTask(t.id);
  check("vazifa kelajakka surildi", after.due_at > Date.now(), `due=${after.due_at}`);
  check("xabar bayrog'i tozalandi", after.notified_at === null);
}

// «Keyinroq» — takrorlanuvchida seriya tegilmaydi, bir martalik nusxa yaratiladi
{
  const t = newTask("Kunlik surish", Date.now() - 60_000, "daily");
  const before = tasksDb.listUpcoming(USER.id, 200).length;

  await handleCallback(makeCtx(`s:${t.id}:60`));

  check("takrorlanuvchi seriya surilmadi", tasksDb.getTask(t.id).due_at === t.due_at);
  check(
    "o'rniga bir martalik nusxa yaratildi",
    tasksDb.listUpcoming(USER.id, 200).length === before + 1,
  );
}

// «O'chirish»
{
  const t = newTask("O'chiriladigan", Date.now() + 60_000);
  await handleCallback(makeCtx(`x:${t.id}`));
  check("vazifa o'chirildi", tasksDb.getTask(t.id) === undefined);
}

// Boshqa foydalanuvchi tegina olmaydi
{
  const t = newTask("Himoyalangan", Date.now() + 60_000);
  await handleCallback(makeCtx(`x:${t.id}`, 987654));
  check("o'zga foydalanuvchi o'chira olmadi", tasksDb.getTask(t.id) !== undefined);
}

// ── Yetkazish sikli ─────────────────────────────────────
section("Eslatma yetkazish");

const { runOnce } = await load("services/scheduler.js");

// Vaqti kelgan eslatma yuboriladi va ikkinchi marta takrorlanmaydi
{
  const t = newTask("Yuboriladigan", Date.now() - 1000);

  apiCalls.length = 0;
  const delivered = await runOnce();

  check("eslatma yuborildi", delivered >= 1, `delivered=${delivered}`);
  check(
    "sendMessage to'g'ri chatga chaqirildi",
    apiCalls.some((c) => c.method === "sendMessage" && c.payload.chat_id === USER.id),
  );
  check("xabar berilgan deb belgilandi", tasksDb.getTask(t.id)?.notified_at !== null);
  check("ikkinchi marta yuborilmadi", (await runOnce()) === 0);
}

// Takrorlanuvchi yuborilgach darhol keyingi qadamga suriladi
{
  const t = newTask("Kunlik yuborish", Date.now() - 1000, "daily");
  await runOnce();

  const after = tasksDb.getTask(t.id);
  check("takrorlanuvchi keyingi qadamga surildi", after.due_at > Date.now(), `due=${after.due_at}`);
  check("qadam ~24 soat", Math.abs(after.due_at - t.due_at - 86_400_000) < 3_600_000);
  check("qayta yuborishga tayyor", after.notified_at === null);
}

// Bot bloklangan (403) — qayta urinish foydasiz, vazifa yopiladi
{
  const t = newTask("Bloklangan foydalanuvchi", Date.now() - 1000);

  failWith = { code: 403, description: "Forbidden: bot was blocked by the user" };
  await runOnce();

  check("bloklanganda vazifa yopildi", tasksDb.getTask(t.id)?.status === "cancelled");
}

// Vaqtinchalik xato — vazifa saqlanadi va keyingi siklda qayta yuboriladi
{
  const t = newTask("Vaqtinchalik xato", Date.now() - 1000);

  failWith = { code: 500, description: "Internal Server Error" };
  await runOnce();

  const after = tasksDb.getTask(t.id);
  check("vaqtinchalik xatoda vazifa yopilmadi", after?.status === "pending");
  check("xabar bayrog'i tozaligicha qoldi", after?.notified_at === null);
  check("keyingi siklda qayta yuborildi", (await runOnce()) >= 1);
}

// ── PUBLIC_URL normallashtirish ─────────────────────────
section("PUBLIC_URL normallashtirish");
{
  const { normalizePublicUrl } = await load("lib/public-url.js");
  const url = (v) => normalizePublicUrl(v)?.url;

  check(
    "sxemasiz domenga https qo'shiladi",
    url("jarvis-production.up.railway.app") === "https://jarvis-production.up.railway.app",
    url("jarvis-production.up.railway.app"),
  );
  check(
    "oxiridagi slash olib tashlanadi",
    url("https://example.com/") === "https://example.com",
  );
  check("to'liq manzil o'zgarmaydi", url("https://example.com") === "https://example.com");
  check("yo'l qismi saqlanadi", url("https://example.com/bot/") === "https://example.com/bot");
  check("lokal http qabul qilinadi", url("http://localhost:3000") === "http://localhost:3000");

  check("bo'sh qiymat null", normalizePublicUrl("") === null);
  check("berilmagan qiymat null", normalizePublicUrl(undefined) === null);

  const insecure = normalizePublicUrl("http://example.com");
  check("HTTPS bo'lmagan tashqi manzil ogohlantiradi", insecure.ok && Boolean(insecure.warning));

  const broken = normalizePublicUrl("http://");
  check("buzuq manzil xato qaytaradi", broken.ok === false, JSON.stringify(broken));
}

await app.close();
try {
  const dbMod = await load("db/index.js");
  dbMod.closeDb();
} catch {}
// Windows'da SQLite fayllari band bo'lishi mumkin — tozalash muvaffaqiyatsizligi testni yiqitmasin.
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch {}

console.log(`\n${"─".repeat(46)}`);
console.log(`Natija: ${passed} o'tdi, ${failed} yiqildi`);
process.exit(failed > 0 ? 1 : 0);
