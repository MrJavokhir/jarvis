import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("db");

const dbPath = path.join(config.dataDir, "jarvis.sqlite");

/**
 * Bazani ochadi. Eng ko'p uchraydigan nosozlik — deployda volume ulanmagan
 * yoki unga yozish huquqi yo'q. SQLite bunda quruq `SQLITE_CANTOPEN` beradi,
 * shuning uchun sababini o'zimiz tushuntiramiz.
 */
function openDatabase(): Database.Database {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
  } catch (error) {
    log.error(
      `Ma'lumotlar papkasini yaratib bo'lmadi: ${config.dataDir}\n` +
        `DATA_DIR to'g'ri ko'rsatilganini va unga yozish huquqi borligini tekshiring.`,
    );
    throw error;
  }

  try {
    return new Database(dbPath);
  } catch (error) {
    if ((error as { code?: string }).code === "SQLITE_CANTOPEN") {
      log.error(
        `Bazani ochib bo'lmadi: ${dbPath}\n` +
          `Ehtimol sabablari:\n` +
          `  • deployda volume ${config.dataDir} ga ulanmagan;\n` +
          `  • yoki konteyner shu papkaga yoza olmayapti (huquq masalasi).\n` +
          `Railway/Render'da volume mount path'i DATA_DIR bilan bir xil bo'lishi kerak.`,
      );
    }
    throw error;
  }
}

export const db: Database.Database = openDatabase();

// WAL — bir vaqtda o'qish/yozish tezroq va bloklanish kamroq bo'ladi.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/**
 * Migratsiyalar. Har biri bir marta bajariladi va `user_version` oshiriladi.
 * Yangi o'zgarish kerak bo'lsa massiv oxiriga yangi element qo'shing —
 * mavjudlarini o'zgartirmang.
 */
const MIGRATIONS: readonly string[] = [
  // v1 — boshlang'ich sxema
  `
  CREATE TABLE users (
    telegram_id   INTEGER PRIMARY KEY,
    first_name    TEXT,
    username      TEXT,
    language_code TEXT,
    timezone      TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    notes       TEXT,
    -- anchor_at: seriyaning birinchi vaqti (kalendarda takrorlanishlarni yozish uchun)
    anchor_at   INTEGER NOT NULL,
    -- due_at: keyingi (yoki yagona) eslatma vaqti, epoch ms UTC
    due_at      INTEGER NOT NULL,
    timezone    TEXT    NOT NULL,
    recurrence  TEXT    NOT NULL DEFAULT 'none'
                CHECK (recurrence IN ('none','daily','weekly','monthly','yearly')),
    status      TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','done','cancelled')),
    source      TEXT    NOT NULL DEFAULT 'manual'
                CHECK (source IN ('voice','text','manual')),
    transcript  TEXT,
    notified_at INTEGER,
    completed_at INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE INDEX idx_tasks_due     ON tasks(status, notified_at, due_at);
  CREATE INDEX idx_tasks_user    ON tasks(user_id, due_at);

  -- Takrorlanuvchi vazifaning har bir alohida bajarilishi
  CREATE TABLE task_completions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    occurrence_at INTEGER NOT NULL,
    completed_at  INTEGER NOT NULL,
    UNIQUE (task_id, occurrence_at)
  );

  CREATE INDEX idx_completions_task ON task_completions(task_id, occurrence_at);
  `,
];

function migrate(): void {
  const current = db.pragma("user_version", { simple: true }) as number;

  if (current > MIGRATIONS.length) {
    throw new Error(
      `Ma'lumotlar bazasi sxemasi (v${current}) kod kutganidan yangi ` +
        `(v${MIGRATIONS.length}). Yangi versiyani deploy qiling yoki bazani tiklang.`,
    );
  }

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (!sql) continue;
    log.info(`migratsiya v${version + 1} qo'llanmoqda`);
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  log.info(`baza tayyor: ${dbPath} (sxema v${MIGRATIONS.length})`);
}

migrate();

export function closeDb(): void {
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  } catch {
    // yopilish vaqtida xato bo'lsa e'tibor bermaymiz
  }
}
