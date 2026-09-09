# Jarvis — ovozli eslatma boti

Telegram bot: **ovozli xabar yuborasiz — u vazifani va sanani o'zi tushunib, aytilgan vaqtda eslatma yuboradi.** Botga o'rnatilgan **Mini App** ichida kalendar bor: vazifalar qaysi kunga rejalashtirilganini ko'rasiz va qo'lda ham qo'shishingiz mumkin.

```
🎤 Ovozli xabar          →  Whisper (matnga o'girish)
                         →  Claude Opus 5 (vazifa + sana/vaqtni ajratish)
                         →  SQLite (saqlash)
                         →  ⏰ Vaqti kelganda Telegram notification
                         →  📅 Mini App kalendarda ko'rinadi
```

---

## Nimalarni qiladi

- **Ovozli xabar** — «ertaga soat uchda shifokorga borishni eslat» deb aytasiz, bot uni tushunib saqlaydi.
- **Matnli xabar** — xuddi shu, faqat yozib yuborasiz.
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
| Ovoz → matn | OpenAI `gpt-4o-transcribe` (o'zbek tili) |
| Matn → vazifa | Claude **`claude-opus-5`**, structured outputs (Zod sxema) |
| Mini App | React 19 + Vite 8, Telegram WebApp SDK |
| Vaqt | Luxon (mintaqaga sezgir takrorlanishlar) |

Claude chaqiruvida server tomonidagi **refusal fallback** yoqilgan (`fallbacks: "default"`) — kutilmagan rad javobida so'rov avtomatik boshqa modelda qayta ishlanadi.

---

## 1. Tayyorgarlik: kalitlarni olish

### Telegram bot tokeni
1. Telegramda [@BotFather](https://t.me/BotFather) ga yozing → `/newbot`
2. Bot nomi va username'ini kiriting
3. Chiqqan tokenni saqlang → `TELEGRAM_BOT_TOKEN`

### Claude API kaliti
[console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key → `ANTHROPIC_API_KEY`

### OpenAI API kaliti (faqat ovozni matnga o'girish uchun)
[platform.openai.com](https://platform.openai.com/api-keys) → Create new secret key → `OPENAI_API_KEY`

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
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
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
npm test         # 40 ta integratsion tekshiruv (auth, API, kalendar, rejalashtiruvchi)
npm run typecheck
```

Testlar tarmoqqa chiqmaydi — vaqtinchalik SQLite bazasi va Fastify `inject` ishlatiladi.

---

## 3. Deploy

Ikkala platformada ham bot **webhook** rejimiga o'tadi (`PUBLIC_URL` berilgani uchun).

> ⚠️ **Muhim:** baza SQLite faylida saqlanadi. Doimiy disk (volume) ulamasangiz, har deploydan keyin **barcha eslatmalar o'chib ketadi**. Quyidagi sozlamalarda disk allaqachon ko'rsatilgan.

### Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. **Variables** bo'limiga qo'shing:
   ```
   TELEGRAM_BOT_TOKEN=...
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   DATA_DIR=/data
   TELEGRAM_WEBHOOK_SECRET=<tasodifiy uzun satr>
   ```
3. **Settings → Networking → Generate Domain** → chiqqan manzilni `PUBLIC_URL` ga yozing
4. **Settings → Volumes → New Volume**, mount path: `/data`

`railway.json` build/start buyruqlarini va `/health` tekshiruvini o'zi hal qiladi.

### Render

1. [render.com](https://render.com) → New → Blueprint → repo'ni tanlang (`render.yaml` o'qiladi)
2. So'ralganda maxfiy kalitlarni kiriting: `TELEGRAM_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

`render.yaml` da disk (`/data`), `PUBLIC_URL` va webhook maxfiy tokeni allaqachon sozlangan.

---

## 4. Mini App'ni botga ulash

Deploy tugagach, [@BotFather](https://t.me/BotFather) da:

```
/setmenubutton
→ botingizni tanlang
→ URL: https://sizning-manzilingiz/
→ Tugma nomi: 📅 Kalendar
```

Endi bot chatida pastda «📅 Kalendar» tugmasi paydo bo'ladi.

---

## Muhit o'zgaruvchilari

| O'zgaruvchi | Majburiy | Standart | Izoh |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | @BotFather tokeni |
| `ANTHROPIC_API_KEY` | ✅ | — | Claude API kaliti |
| `OPENAI_API_KEY` | ✅ | — | Whisper (ovoz → matn) |
| `PUBLIC_URL` | deployda | — | Ochiq HTTPS manzil. Berilsa webhook rejimi yoqiladi |
| `BOT_MODE` | | avtomatik | `polling` yoki `webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | | avto-generatsiya | Webhook so'rovlarini tekshirish |
| `PORT` | | `3000` | Server porti |
| `DATA_DIR` | | `./data` | SQLite fayl papkasi (deployda `/data`) |
| `DEFAULT_TIMEZONE` | | `Asia/Tashkent` | Yangi foydalanuvchilar uchun |
| `SCHEDULER_INTERVAL_SECONDS` | | `30` | Eslatmalarni tekshirish davri |
| `MAX_VOICE_DURATION_SECONDS` | | `300` | Ovozli xabar uzunligi chegarasi |
| `STT_MODEL` | | `gpt-4o-transcribe` | `whisper-1` ham bo'ladi |
| `CLAUDE_MODEL` | | `claude-opus-5` | Tahlil modeli |
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
    parser.ts          Claude structured outputs bilan tahlil
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
