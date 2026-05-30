import "server-only";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, enableWalMode } from "./client";

export function runMigrations() {
  enableWalMode();

  const envFolder = process.env.MIGRATIONS_FOLDER;
  const migrationsFolder = envFolder
    ? path.resolve(/* turbopackIgnore: true */ envFolder)
    : path.join(process.cwd(), "drizzle");
  migrate(db, { migrationsFolder });
}
