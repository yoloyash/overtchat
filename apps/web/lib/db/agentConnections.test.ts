import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-agent-connections-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    role TEXT DEFAULT 'admin',
    banned INTEGER DEFAULT 0
  );
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
  CREATE TABLE agent_hosts (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    name TEXT NOT NULL,
    transport TEXT NOT NULL,
    ssh_alias TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    FOREIGN KEY (connector_id) REFERENCES host_connectors(id) ON DELETE CASCADE
  );
  CREATE TABLE agent_connections (
    id TEXT PRIMARY KEY NOT NULL,
    host_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    executable TEXT NOT NULL,
    shell_mode TEXT NOT NULL DEFAULT 'login',
    detected_version TEXT,
    last_validated_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (host_id) REFERENCES agent_hosts(id) ON DELETE CASCADE,
    UNIQUE (host_id, provider)
  );
  CREATE TABLE agent_workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    connection_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (connection_id) REFERENCES agent_connections(id) ON DELETE CASCADE,
    UNIQUE (connection_id, path)
  );
  CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    provider_session_path TEXT NOT NULL,
    name TEXT,
    first_message TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    provider_created_at INTEGER,
    provider_modified_at INTEGER,
    last_synced_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (workspace_id) REFERENCES agent_workspaces(id) ON DELETE CASCADE,
    UNIQUE (workspace_id, provider_session_path)
  );
`);

let repository: typeof import("./agentConnections");

beforeAll(async () => {
  repository = await import("./agentConnections");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM agent_sessions;
    DELETE FROM agent_workspaces;
    DELETE FROM agent_connections;
    DELETE FROM agent_hosts;
    DELETE FROM host_connectors;
    DELETE FROM user;
    INSERT INTO user (id) VALUES ('alice'), ('bob');
    INSERT INTO host_connectors (id, user_id, name, token_hash)
    VALUES ('alice-connector', 'alice', 'Alice host', 'test-hash');
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

function createAliceConnection() {
  return repository.createAgentConnection({
    userId: "alice",
    host: {
      name: "Workstation",
      transport: "local",
      connectorId: "alice-connector",
    },
    connection: {
      provider: "pi",
      executable: "pi",
      shellMode: "interactive",
      detectedVersion: "0.82.1",
    },
  });
}

describe("agent connection persistence", () => {
  it("returns the nested connection, workspace, and session hierarchy", async () => {
    const owned = createAliceConnection();
    const workspace = await repository.createAgentWorkspace(
      owned.connection.id,
      "alice",
      { path: "/work/overtchat", name: "overtchat" },
    );
    expect(workspace).not.toBeNull();

    repository.syncAgentWorkspaceSessions(workspace!.id, [
      {
        providerSessionId: "newer",
        providerSessionPath: "/pi/newer.jsonl",
        name: "Fix settings",
        firstMessage: "Fix the settings screen",
        messageCount: 4,
        createdAt: new Date(1_000),
        modifiedAt: new Date(3_000),
      },
      {
        providerSessionId: "older",
        providerSessionPath: "/pi/older.jsonl",
        name: null,
        firstMessage: "Review this repository",
        messageCount: 2,
        createdAt: new Date(500),
        modifiedAt: new Date(2_000),
      },
    ]);

    await expect(repository.listAgentConnections("alice")).resolves.toEqual([
      expect.objectContaining({
        id: owned.connection.id,
        provider: "pi",
        detectedVersion: "0.82.1",
        host: expect.objectContaining({
          name: "Workstation",
          transport: "local",
        }),
        workspaces: [
          expect.objectContaining({
            path: "/work/overtchat",
            sessions: [
              expect.objectContaining({
                providerSessionId: "newer",
                name: "Fix settings",
              }),
              expect.objectContaining({
                providerSessionId: "older",
              }),
            ],
          }),
        ],
      }),
    ]);
  });

  it("updates and prunes only cached session metadata on a full sync", async () => {
    const owned = createAliceConnection();
    const workspace = await repository.createAgentWorkspace(
      owned.connection.id,
      "alice",
      { path: "/work/overtchat", name: "overtchat" },
    );
    repository.syncAgentWorkspaceSessions(workspace!.id, [
      {
        providerSessionId: "keep",
        providerSessionPath: "/remote/keep.jsonl",
        name: "Old name",
        firstMessage: "First",
        messageCount: 1,
        createdAt: null,
        modifiedAt: new Date(1_000),
      },
      {
        providerSessionId: "remove",
        providerSessionPath: "/remote/remove.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: null,
        modifiedAt: null,
      },
    ]);

    const rows = repository.syncAgentWorkspaceSessions(workspace!.id, [
      {
        providerSessionId: "keep",
        providerSessionPath: "/remote/keep.jsonl",
        name: "New name",
        firstMessage: "First",
        messageCount: 3,
        createdAt: null,
        modifiedAt: new Date(2_000),
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      providerSessionId: "keep",
      providerSessionPath: "/remote/keep.jsonl",
      name: "New name",
      messageCount: 3,
    });
  });

  it("enforces ownership through every level and cascades only local rows", async () => {
    const owned = createAliceConnection();
    const workspace = await repository.createAgentWorkspace(
      owned.connection.id,
      "alice",
      { path: "/work/overtchat", name: "overtchat" },
    );
    const agentSession = await repository.upsertAgentSession(workspace!.id, {
      providerSessionId: "session",
      providerSessionPath: "/remote/session.jsonl",
      name: null,
      firstMessage: null,
      messageCount: 0,
      createdAt: null,
      modifiedAt: null,
    });

    await expect(
      repository.getOwnedAgentConnection(owned.connection.id, "bob"),
    ).resolves.toBeNull();
    await expect(
      repository.getOwnedAgentWorkspace(workspace!.id, "bob"),
    ).resolves.toBeNull();
    await expect(
      repository.getOwnedAgentSession(agentSession.id, "bob"),
    ).resolves.toBeNull();
    await expect(
      repository.deleteAgentWorkspace(workspace!.id, "bob"),
    ).resolves.toBe(false);

    await expect(
      repository.deleteAgentConnection(owned.connection.id, "alice"),
    ).resolves.toBe(true);
    expect(
      raw.prepare("SELECT count(*) AS count FROM agent_sessions").get(),
    ).toEqual({ count: 0 });
    expect(
      raw.prepare("SELECT count(*) AS count FROM agent_workspaces").get(),
    ).toEqual({ count: 0 });
  });

  it("reconciles only sessions still authorized for a connector", async () => {
    const owned = createAliceConnection();
    const workspace = await repository.createAgentWorkspace(
      owned.connection.id,
      "alice",
      { path: "/work/overtchat", name: "overtchat" },
    );
    const agentSession = await repository.upsertAgentSession(workspace!.id, {
      providerSessionId: "session",
      providerSessionPath: "/remote/session.jsonl",
      name: null,
      firstMessage: null,
      messageCount: 0,
      createdAt: null,
      modifiedAt: null,
    });

    await expect(
      repository.listActiveAgentSessionIds("alice-connector"),
    ).resolves.toEqual([agentSession.id]);

    raw.prepare("UPDATE user SET role = 'user' WHERE id = 'alice'").run();
    await expect(
      repository.listActiveAgentSessionIds("alice-connector"),
    ).resolves.toEqual([]);

    raw.prepare(
      "UPDATE user SET role = 'admin', banned = 1 WHERE id = 'alice'",
    ).run();
    await expect(
      repository.listActiveAgentSessionIds("alice-connector"),
    ).resolves.toEqual([]);
  });
});
