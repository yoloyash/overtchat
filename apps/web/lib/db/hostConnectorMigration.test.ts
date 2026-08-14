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
    database.pragma("foreign_keys = ON");
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
      CREATE TABLE agent_hosts (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
        connector_id TEXT NOT NULL REFERENCES host_connectors(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        ssh_alias TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE agent_connections (
        id TEXT PRIMARY KEY NOT NULL,
        host_id TEXT NOT NULL REFERENCES agent_hosts(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        executable TEXT NOT NULL,
        shell_mode TEXT NOT NULL,
        detected_version TEXT,
        last_validated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE agent_workspaces (
        id TEXT PRIMARY KEY NOT NULL,
        connection_id TEXT NOT NULL REFERENCES agent_connections(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES agent_workspaces(id) ON DELETE CASCADE,
        provider_session_id TEXT NOT NULL,
        provider_session_path TEXT NOT NULL,
        name TEXT,
        first_message TEXT,
        message_count INTEGER NOT NULL,
        provider_created_at INTEGER,
        provider_modified_at INTEGER,
        last_synced_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO agent_hosts
        (id, user_id, connector_id, name, transport, created_at, updated_at)
      VALUES
        ('host', 'existing-admin', 'legacy', 'Local', 'local', 1, 2);
      INSERT INTO agent_connections
        (id, host_id, provider, executable, shell_mode, created_at, updated_at)
      VALUES
        ('connection', 'host', 'codex', 'codex', 'login', 3, 4);
      INSERT INTO agent_workspaces
        (id, connection_id, path, name, created_at, updated_at)
      VALUES
        ('workspace', 'connection', '/srv/project', 'Project', 5, 6);
      INSERT INTO agent_sessions
        (id, workspace_id, provider_session_id, provider_session_path, message_count, last_synced_at, created_at, updated_at)
      VALUES
        ('session', 'workspace', 'provider-session', '/tmp/session', 7, 8, 9, 10);
    `);
    const migration = fs.readFileSync(
      path.resolve(process.cwd(), "drizzle/0010_deep_nico_minoru.sql"),
      "utf8",
    );
    database.exec("BEGIN");
    try {
      for (const statement of migration.split("--> statement-breakpoint")) {
        if (statement.trim()) database.exec(statement);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
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
    expect(database.prepare("SELECT * FROM agent_hosts").all()).toEqual([
      {
        id: "host",
        user_id: "existing-admin",
        connector_id: "legacy",
        name: "Local",
        transport: "local",
        ssh_alias: null,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    expect(database.prepare("SELECT * FROM agent_connections").all()).toEqual([
      {
        id: "connection",
        host_id: "host",
        provider: "codex",
        executable: "codex",
        shell_mode: "login",
        detected_version: null,
        last_validated_at: null,
        created_at: 3,
        updated_at: 4,
      },
    ]);
    expect(database.prepare("SELECT * FROM agent_workspaces").all()).toEqual([
      {
        id: "workspace",
        connection_id: "connection",
        path: "/srv/project",
        name: "Project",
        created_at: 5,
        updated_at: 6,
      },
    ]);
    expect(database.prepare("SELECT * FROM agent_sessions").all()).toEqual([
      {
        id: "session",
        workspace_id: "workspace",
        provider_session_id: "provider-session",
        provider_session_path: "/tmp/session",
        name: null,
        first_message: null,
        message_count: 7,
        provider_created_at: null,
        provider_modified_at: null,
        last_synced_at: 8,
        created_at: 9,
        updated_at: 10,
      },
    ]);
    expect(database.pragma("foreign_key_check")).toEqual([]);
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
