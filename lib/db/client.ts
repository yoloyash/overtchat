import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";

const DB_PATH = process.env.DATABASE_URL ?? "./data/chat.db";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle({ client: sqlite });

const migrationsFolder = path.join(process.cwd(), "drizzle");
if (fs.existsSync(migrationsFolder)) {
  migrate(db, { migrationsFolder });
}

void import("./uploads").then(({ sweepOrphanedUploads }) =>
  sweepOrphanedUploads().catch((err) =>
    console.error("[sweep-orphan-uploads]", err),
  ),
);
