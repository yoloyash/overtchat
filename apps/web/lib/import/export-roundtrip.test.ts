import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-export-import-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.exec(`
  CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT,
    active_stream_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    message_id UNINDEXED,
    chat_id UNINDEXED,
    user_id UNINDEXED
  );
`);

let exportChat: typeof import("../export").exportChat;
let importChats: typeof import(".").importChats;
let importOurs: typeof import("./ours").importOurs;
let sniffFormat: typeof import("./sniff").sniffFormat;

beforeAll(async () => {
  ({ exportChat } = await import("../export"));
  ({ importChats } = await import("."));
  ({ importOurs } = await import("./ours"));
  ({ sniffFormat } = await import("./sniff"));
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

function seedExportSource() {
  raw
    .prepare(
      `INSERT INTO chats (
        id, user_id, project_id, title, active_stream_id, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, NULL, ?, ?)`,
    )
    .run("source-chat", "user", "Context meter", 1_000, 3_000);

  const insertMessage = raw.prepare(
    `INSERT INTO messages (
      id, chat_id, role, parts, metadata, created_at
    ) VALUES (?, 'source-chat', ?, ?, ?, ?)`,
  );
  insertMessage.run(
    "source-user",
    "user",
    JSON.stringify([{ type: "text", text: "Hello" }]),
    null,
    1_000,
  );
  insertMessage.run(
    "source-assistant",
    "assistant",
    JSON.stringify([{ type: "text", text: "Hi" }]),
    JSON.stringify({
      stats: {
        contextTokens: 8_192,
        responseTokens: 256,
      },
    }),
    2_000,
  );
}

describe("native export/import compatibility", () => {
  it("round-trips the native export envelope and message metadata", async () => {
    seedExportSource();

    const payload = await exportChat("source-chat", "user");
    expect(payload).not.toBeNull();
    expect("messages" in (payload ?? {})).toBe(false);
    expect(payload?.chats[0]?.messages[1]?.metadata).toEqual({
      stats: {
        contextTokens: 8_192,
        responseTokens: 256,
      },
    });

    const result = await importChats(
      "user",
      new TextEncoder().encode(JSON.stringify(payload)),
    );
    expect(result).toEqual({
      format: "ours",
      importedChats: 1,
      importedMessages: 2,
    });

    const importedChat = raw
      .prepare(
        `SELECT id, title
         FROM chats
         WHERE user_id = ? AND id <> ?
         ORDER BY rowid DESC
         LIMIT 1`,
      )
      .get("user", "source-chat") as
      | { id: string; title: string }
      | undefined;
    expect(importedChat?.title).toBe("Context meter");

    const importedMessages = raw
      .prepare(
        `SELECT role, parts, metadata
         FROM messages
         WHERE chat_id = ?
         ORDER BY rowid`,
      )
      .all(importedChat?.id) as {
      role: string;
      parts: string;
      metadata: string | null;
    }[];
    expect(importedMessages).toEqual([
      {
        role: "user",
        parts: JSON.stringify([{ type: "text", text: "Hello" }]),
        metadata: null,
      },
      {
        role: "assistant",
        parts: JSON.stringify([{ type: "text", text: "Hi" }]),
        metadata: JSON.stringify({
          stats: {
            contextTokens: 8_192,
            responseTokens: 256,
          },
        }),
      },
    ]);
  });

  it("keeps legacy direct-chat and chat-array imports working", () => {
    const chat = {
      title: "Legacy export",
      createdAt: "2026-07-29T00:00:00.000Z",
      messages: [
        {
          role: "assistant",
          parts: [{ type: "text", text: "Old shape" }],
          metadata: { stats: { contextTokens: 512 } },
          createdAt: "2026-07-29T00:00:01.000Z",
        },
      ],
    };

    expect(sniffFormat(chat)).toBe("ours");
    expect(sniffFormat([chat])).toBe("ours");
    expect(importOurs(chat)).toEqual(importOurs([chat]));
    expect(importOurs(chat)[0]?.messages[0]?.metadata).toEqual({
      stats: { contextTokens: 512 },
    });
  });
});
