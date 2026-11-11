import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A throwaway SQLite file holding the integration tables from their real
 * migrations. Call before importing anything that opens `@/lib/db/client`.
 */
export function createIntegrationTestDatabase(name: string) {
  const databasePath = path.join(
    os.tmpdir(),
    `overtchat-${name}-${process.pid}-${Date.now()}.db`,
  );
  process.env.DATABASE_URL = databasePath;
  const raw = new Database(databasePath);
  raw.exec("CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);");
  for (const name of [
    "0030_integrations",
    "0032_gmail_emails",
    "0033_gmail_send_without_asking",
  ]) {
    const migration = fs.readFileSync(
      path.resolve(__dirname, `../../drizzle/${name}.sql`),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      raw.exec(statement);
    }
  }
  return {
    raw,
    reset() {
      raw.exec(`
        DELETE FROM gmail_emails;
        DELETE FROM gmail_sent_drafts;
        DELETE FROM integration_authorizations;
        DELETE FROM integration_accounts;
        DELETE FROM integration_oauth_clients;
        DELETE FROM user;
        INSERT INTO user (id) VALUES ('ada'), ('grace');
      `);
    },
    close() {
      raw.close();
      fs.rmSync(databasePath, { force: true });
    },
  };
}
