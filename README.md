# Jarvis — ovozli eslatma boti

Telegram bot: **ovozli xabar yuborasiz — u vazifani va sanani o'zi tushunib, aytilgan vaqtda eslatma yuboradi.** Botga o'rnatilgan **Mini App** ichida kalendar bor: vazifalar qaysi kunga rejalashtirilganini ko'rasiz va qo'lda ham qo'shishingiz mumkin.

```
🎤 Ovozli xabar  →  Whisper (matnga o'girish)  →  GPT (vazifa + sana ajratish)
💬 Matn          →  qoidalar asosidagi tahlilchi (AI'siz, bepul, bir zumda)
                         →  SQLite (saqlash)
                         →  ⏰ Vaqti kelganda Telegram notification
                         →  📅 Mini App kalendarda ko'rinadi
```

---

## Nimalarni qiladi

- **Ovozli xabar** — «ertaga soat uchda shifokorga borishni eslat» deb aytasiz, bot uni tushunib saqlaydi.
- **Matnli xabar** — AI'siz, qoidalar bilan o'qiladi: `ertaga 15:00 shifokorga borish`, `har kuni 08:00 dori ichish`, `2 soatdan keyin suv ich`. Tez va bepul.
- **Nisbiy vaqtlar** — «ertaga», «indinga», «keyingi dushanba», «2 soatdan keyin», «oyning oxirida» — hammasi aniq sanaga aylantiriladi.
- **Takrorlanish** — «har kuni», «har hafta», «har oy», «har yili».
- **Bitta xabarda bir nechta vazifa** — hammasi alohida eslatma bo'lib saqlanadi.
- **Eslatma vaqtida** — bot xabar yuboradi, «Bajarildi» va «Keyinroq» tugmalari bilan.
- **Mini App kalendar** — oylik ko'rinish, har kun ostida vazifa nuqtalari, kun bo'yicha ro'yxat, qo'lda qo'shish/tahrirlash/o'chirish.

### Bot buyruqlari

| Buyruq | Vazifasi |
|---|---|
| `/start` | Botni boshlash va qisqa yo'riqnoma |
| `/vazifalar` | Yaqin eslatmalar ro'yxati |
| `/kalendar` | Mini App kalendarni ochish |
| `/vaqt` | Vaqt mintaqasini ko'rish/o'zgartirish |
| `/yordam` | To'liq yo'riqnoma |

---

## Texnologiyalar

| Qism | Nima ishlatilgan |
|---|---|
| Bot | [grammY](https://grammy.dev) (Telegram Bot API) |
| Server | Fastify 5 + `@fastify/static` |
| Baza | SQLite (`better-sqlite3`), WAL rejimida |
| Ovoz → matn | OpenAI `whisper-1` (o'zbek tili) |
| Ovozdan vazifa | OpenAI `gpt-4o`, structured outputs (Zod sxema) |
| Matndan vazifa | O'z tahlilchimiz — AI'siz, `src/services/text-parser.ts` |
| Mini App | React 19 + Vite 8, Telegram WebApp SDK |
| Vaqt | Luxon (mintaqaga sezgir takrorlanishlar) |

Ikkala qadam ham bitta OpenAI kaliti orqali ketadi. Tahlilda **structured outputs** ishlatiladi — model javobi Zod sxemasiga qat'iy mos kelishi kafolatlanadi, shuning uchun JSON qo'lda tozalanmaydi.

---

## 1. Tayyorgarlik: kalitlarni olish

### Telegram bot tokeni
1. Telegramda [@BotFather](https://t.me/BotFather) ga yozing → `/newbot`
2. Bot nomi va username'ini kiriting
3. Chiqqan tokenni saqlang → `TELEGRAM_BOT_TOKEN`

### OpenAI API kaliti
[platform.openai.com](https://platform.openai.com/api-keys) → Create new secret key → `OPENAI_API_KEY`

Shu bitta kalit ikkala ish uchun ishlatiladi: ovozni matnga o'girish va matndan vazifa/sana ajratish.

---

## 2. Lokal ishga tushirish

```bash
git clone https://github.com/MrJavokhir/jarvis.git
cd jarvis

npm install
npm --prefix webapp install

cp .env.example .env      # keyin .env ichini to'ldiring
```

`.env` da kamida shular bo'lishi kerak:

```dotenv
TELEGRAM_BOT_TOKEN=123456:AA...
OPENAI_API_KEY=sk-proj-...
```

`PUBLIC_URL` bo'sh bo'lsa bot **long polling** rejimida ishlaydi — lokal test uchun shu yetarli.

Ikkita terminalda:

```bash
npm run dev       # bot + API server  (http://localhost:3000)
npm run dev:web   # Mini App          (http://localhost:5173)
```

Endi botga ovozli xabar yuboring — eslatma saqlanishi kerak.

> **Mini App lokalda:** Telegram Mini App faqat HTTPS manzilni qabul qiladi. Lokal sinash uchun tunnel oching:
> ```bash
> npx cloudflared tunnel --url http://localhost:3000
> ```
> Chiqqan `https://...trycloudflare.com` manzilini `.env` dagi `PUBLIC_URL` ga yozing va serverni qayta ishga tushiring.

### Testlar

```bash
npm test         # 122 ta integratsion tekshiruv
npm run typecheck
```

Qamrab olingan: initData imzosi, REST API, kalendarga takrorlanishlarni yozish,
bajarilganlik belgisi, bot tugmalari (bajarildi / keyinroq / o'chirish), eslatma
yetkazish sikli (takroriy yuborilmaslik, bloklangan foydalanuvchi, vaqtinchalik
xatoda qayta urinish) va vaqt hisoblari.

Testlar tarmoqqa chiqmaydi — vaqtinchalik SQLite bazasi, Fastify `inject` va
ushlab qolingan Telegram API chaqiruvlari ishlatiladi.

---

## 3. Deploy

Deploy **Dockerfile** orqali amalga oshiriladi (`railway.json` va `render.yaml` shunga ko'rsatilgan). Bu ataylab tanlangan: `better-sqlite3` paket ichida tayyor binar bilan kelsa ham, npm uning ildizidagi `binding.gyp` ni ko'rib avtomatik `node-gyp rebuild` ni ishga tushiradi — Nixpacks kabi tayyor build muhitlarida esa Python bo'lmagani uchun bu `gyp ERR! not ok` bilan yiqiladi. Dockerfile'da qurish bosqichiga `python3 make g++` qo'shilgan, runtime image esa ularsiz toza qoladi.

Ikkala platformada ham bot **webhook** rejimiga o'tadi (`PUBLIC_URL` berilgani uchun).

> ⚠️ **Muhim:** baza SQLite faylida saqlanadi. Doimiy disk (volume) ulamasangiz, har deploydan keyin **barcha eslatmalar o'chib ketadi**.

### Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. **Settings → Volumes → New Volume**, mount path: `/data`
3. **Settings → Networking → Generate Domain**
4. **Variables** bo'limiga qo'shing:

   ```
   TELEGRAM_BOT_TOKEN=...
   OPENAI_API_KEY=...
   PUBLIC_URL=https://<3-qadamda chiqqan domen>
   TELEGRAM_WEBHOOK_SECRET=<tasodifiy uzun satr>
   ```

`DATA_DIR=/data` Dockerfile ichida o'rnatilgan — uni qo'shish shart emas. Railway `railway.json` ni ko'rib Dockerfile bilan quradi.

### Render

1. [render.com](https://render.com) → New → Blueprint → repo'ni tanlang (`render.yaml` o'qiladi)
2. So'ralganda maxfiy kalitlarni kiriting: `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY`

Disk (`/data`), `PUBLIC_URL` va webhook maxfiy tokeni `render.yaml` da allaqachon sozlangan.

### Deploy to'g'ri ketganini bilish

Loglarda ketma-ket shular chiqishi kerak:

```
INFO  [db]   baza tayyor: /data/jarvis.sqlite (sxema v1)
INFO  [web]  server tinglayapti: http://0.0.0.0:3000
INFO  [bot]  bot ulandi: @sizning_botingiz
INFO  [bot]  menyu tugmasi Mini App'ga ulandi: https://...
INFO  [main] webhook o'rnatildi: https://.../telegram/webhook
INFO  [main] Jarvis tayyor ✅
```

`getMe failed (401: Unauthorized)` chiqsa — `TELEGRAM_BOT_TOKEN` noto'g'ri.

---

## 4. Mini App'ni botga ulash

**Qo'lda hech narsa qilish shart emas.** `PUBLIC_URL` sozlangan bo'lsa, bot ishga tushganda buyruqlar ro'yxatini va «🗓 Kalendar» menyu tugmasini Telegramda o'zi ro'yxatdan o'tkazadi (`registerBotMetadata()`, [src/bot/index.ts](src/bot/index.ts)).

Loglarda shu satrni ko'rsangiz — hammasi joyida:

```
INFO  [bot] menyu tugmasi Mini App'ga ulandi: https://sizning-manzilingiz/
```

Tugma paydo bo'lmasa, Telegram ilovasini yopib qayta oching (menyu keshlanadi). Zarur bo'lsa qo'lda ham qo'yish mumkin: [@BotFather](https://t.me/BotFather) → `/setmenubutton` → botingiz → URL → tugma nomi.

Eslatma xabaridagi «🗓 Kalendarda ko'rish» va «✏️ O'zgartirish» tugmalari Mini App'ni `?taskId=N` bilan ochadi — kalendar o'sha vazifaning kuniga sakrab, tahrirlash oynasini darhol ko'rsatadi.

---

## Muhit o'zgaruvchilari

| O'zgaruvchi | Majburiy | Standart | Izoh |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | @BotFather tokeni |
| `OPENAI_API_KEY` | ✅ | — | Ovoz → matn va matn → vazifa, ikkalasi ham |
| `PUBLIC_URL` | deployda | — | Ochiq HTTPS manzil. Berilsa webhook rejimi yoqiladi |
| `BOT_MODE` | | avtomatik | `polling` yoki `webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | | avto-generatsiya | Webhook so'rovlarini tekshirish |
| `PORT` | | `3000` | Server porti |
| `DATA_DIR` | | `./data` | SQLite fayl papkasi (deployda `/data`) |
| `DEFAULT_TIMEZONE` | | `Asia/Tashkent` | Yangi foydalanuvchilar uchun |
| `SCHEDULER_INTERVAL_SECONDS` | | `30` | Eslatmalarni tekshirish davri |
| `MAX_VOICE_DURATION_SECONDS` | | `300` | Ovozli xabar uzunligi chegarasi |
| `STT_MODEL` | | `whisper-1` | Ovoz modeli. `gpt-4o-transcribe` ruxsat talab qilishi mumkin |
| `PARSER_MODEL` | | `gpt-4o` | Tahlil modeli. Structured outputs qo'llab-quvvatlashi shart |
| `LOG_LEVEL` | | `info` | `debug` / `info` / `warn` / `error` |

---

## Loyiha tuzilishi

```
src/
  config.ts            muhit o'zgaruvchilarini o'qish va tekshirish (Zod)
  index.ts             ishga tushirish, webhook/polling, to'xtatish
  db/
    index.ts           SQLite ulanish + migratsiyalar
    tasks.ts           vazifalar CRUD, takrorlanishlarni surish
    users.ts           foydalanuvchi va mintaqa
  bot/
    index.ts           buyruqlar va xabar yo'naltirish
    handlers/voice.ts  ovozli xabar → transkripsiya
    handlers/create.ts ajratilgan vazifalarni saqlash
    handlers/callbacks.ts  «Bajarildi» / «Keyinroq» tugmalari
    format.ts          xabar matnlari, keyboards.ts  tugmalar
  services/
    stt.ts             Telegramdan yuklab olish + Whisper
    parser.ts          ovoz uchun: OpenAI structured outputs bilan tahlil
    text-parser.ts     matn uchun: qoidalar asosida tahlil (AI'siz)
    scheduler.ts       vaqti kelgan eslatmalarni yuborish
  web/
    server.ts          Fastify, statik Mini App, webhook endpoint
    routes.ts          REST API
    auth.ts            Telegram initData HMAC tekshiruvi
  lib/
    time.ts            mintaqaga sezgir vaqt hisoblari
    occurrences.ts     takrorlanishlarni kalendar oralig'iga yozish

webapp/                React Mini App (kalendar)
tests/smoke.mjs        integratsion testlar
```

---

## Qanday ishlaydi (tafsilotlar)

**Xavfsizlik.** Mini App har so'rovda Telegramning `initData` satrini `Authorization: tma ...` sarlavhasida yuboradi. Server uni bot tokeni bilan HMAC-SHA256 orqali tekshiradi ([Telegram spetsifikatsiyasi](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)), imza mos kelmasa yoki 24 soatdan eski bo'lsa — `401`. Foydalanuvchi faqat o'z vazifalarini ko'radi va o'zgartiradi.

**Vaqt.** Barcha vaqtlar bazada UTC epoch millisekundda saqlanadi, ko'rsatishda foydalanuvchi mintaqasiga o'giriladi. Takrorlanish qadami mintaqa ichida tashlanadi — shuning uchun soat siljishi bo'lsa ham «har kuni 09:00» aynan 09:00 bo'lib qoladi.

**Takrorlanishlar.** Bazada bitta yozuv saqlanadi (`anchor_at` — seriya boshi, `due_at` — keyingi eslatma). Kalendar so'ralganda takrorlanishlar shu oraliqqa yozib chiqiladi. Har bir takrorlanishning «bajarildi» belgisi alohida jadvalda (`task_completions`) turadi, shuning uchun kunlik eslatmani bir kun bajarib, ertasiga qayta olish mumkin.

**Eslatma yuborish.** Rejalashtiruvchi har 30 soniyada vaqti kelgan vazifalarni qidiradi. Yuborilgach `notified_at` belgilanadi — takroriy yuborilmasligi uchun. Takrorlanuvchi vazifa darhol keyingi qadamga suriladi. Foydalanuvchi botni bloklagan bo'lsa (`403`), vazifa yopiladi.

### Ma'lum cheklovlar

- **Bitta instans.** SQLite va xotiradagi taymer — bir vaqtda faqat bitta nusxa ishlashi kerak. Gorizontal masshtab kerak bo'lsa Postgres va tashqi navbatga o'tish lozim.
- **Takrorlanuvchi vazifani tahrirlash butun seriyaga ta'sir qiladi** — alohida bir kunni o'zgartirish hozircha yo'q.
- **Haftalik takrorlanish** boshlang'ich sanadagi hafta kuniga bog'lanadi (bir nechta kun tanlash yo'q).

---

## Litsenziya

MIT
