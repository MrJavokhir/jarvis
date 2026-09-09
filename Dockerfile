# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
#  1-bosqich — qurish
# ─────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 paket ichida tayyor binar bilan keladi va odatda hech nima
# kompilyatsiya qilinmasligi kerak. Lekin npm hujjatlashtirilgan qoidaga ko'ra
# paket ildizida `binding.gyp` ko'rsa va paketning o'z `install` skripti
# bo'lmasa, avtomatik `node-gyp rebuild` ishga tushiradi. Shuning uchun
# qurish bosqichida Python va kompilyator turishi shart — aks holda
# `npm ci` "gyp ERR! not ok" bilan yiqiladi.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Avval faqat manifestlarni ko'chiramiz — kod o'zgarganda ham
# bog'liqliklar qatlami keshdan olinadi.
COPY package.json package-lock.json ./
COPY webapp/package.json webapp/package-lock.json ./webapp/

RUN npm ci
RUN npm --prefix webapp ci

# Endi manba kod
COPY tsconfig.json ./
COPY src ./src
COPY webapp ./webapp

# `npm run build` ichidagi `build:web` webapp bog'liqliklarini qaytadan
# o'rnatadi — bu yerda ular allaqachon o'rnatilgan, shuning uchun
# bosqichlarni alohida chaqiramiz.
RUN npm run build:server
RUN npm --prefix webapp run build

# Runtime uchun dev bog'liqliklar kerak emas. `prune` qayta o'rnatmaydi,
# shuning uchun node-gyp boshqa ishga tushmaydi.
RUN npm prune --omit=dev

# ─────────────────────────────────────────────────────────────
#  2-bosqich — ishga tushirish
# ─────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
# Railway/Render volume shu yo'lga ulanadi. Volume ulanmasa ham
# konteyner ichida ishlaydi, lekin qayta deployda ma'lumot yo'qoladi.
ENV DATA_DIR=/data

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/webapp/dist ./webapp/dist
COPY package.json ./

RUN mkdir -p /data

# Konteyner root ostida ishlaydi — bu ataylab.
# Railway va Render doimiy volume'ni mount nuqtasiga root egaligida ulaydi va
# uning egasini sozlash imkoni yo'q. `USER node` bilan ishlaganda SQLite
# `/data` ga yoza olmay `SQLITE_CANTOPEN` beradi. Huquqni tushirish uchun
# ishga tushishda `chown` qilib, keyin foydalanuvchini almashtiruvchi
# entrypoint kerak bo'lardi — bu yerda u qo'shimcha murakkablikka arzimaydi,
# chunki konteynerning o'zi izolyatsiya chegarasi bo'lib turibdi.

EXPOSE 3000

CMD ["node", "dist/index.js"]
