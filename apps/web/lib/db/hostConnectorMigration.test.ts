import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-connector-migration-${process.pid}-${Date.now()}.db`,
);

afterAll(() => {
  fs.rmSync(databasePath, { force: true });
});

describe("managed connector migration", () => {
  it("preserves a legacy connector and permits pre-admin provisioning", () => {
    const database = new Database(databasePath);
    database.exec(`
      CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO user (id) VALUES ('existing-admin');
      CREATE TABLE host_connectors (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        version TEXT,
        last_seen_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
        updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
        FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX host_connectors_userId_idx ON host_connectors (user_id);
      INSERT INTO host_connectors (id, user_id, name, token_hash, version)
      VALUES ('legacy', 'existing-admin', 'Existing host', 'hash', '0.3.4');
    `);
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "drizzle/0010_deep_nico_minoru.sql"),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement);
    }

    expect(
      database.prepare("SELECT id, user_id, managed, name FROM host_connectors").all(),
    ).toEqual([
      {
        id: "legacy",
        user_id: "existing-admin",
        managed: 0,
        name: "Existing host",
      },
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'server_capabilities'",
        )
        .get(),
    ).toEqual({ name: "server_capabilities" });
    expect(() =>
      database
        .prepare(
          "INSERT INTO host_connectors (id, user_id, managed, name, token_hash) VALUES (?, NULL, true, ?, ?)",
        )
        .run("pending", "Setup host", "new-hash"),
    ).not.toThrow();
    database.close();
  });
});
