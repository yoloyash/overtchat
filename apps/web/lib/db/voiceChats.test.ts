import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-voice-chats-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT,
    kind TEXT NOT NULL DEFAULT 'text',
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

let voiceChats: typeof import("./voiceChats");
let chatQueries: typeof import("./chats");

beforeAll(async () => {
  [voiceChats, chatQueries] = await Promise.all([
    import("./voiceChats"),
    import("./chats"),
  ]);
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM messages;
    DELETE FROM messages_fts;
    DELETE FROM chats;
    DELETE FROM projects;
    DELETE FROM user;
    INSERT INTO user (id) VALUES ('user'), ('other');
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("voice chat persistence", () => {
  it("creates a voice chat and idempotently upserts canonical messages", () => {
    const user = {
      id: "voice:chat:user-1",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello" }],
    };
    const first = voiceChats.syncVoiceHistory({
      chatId: "chat",
      userId: "user",
      projectId: null,
      allowCreate: true,
      history: [user],
    });

    expect(first).toMatchObject({
      status: "ok",
      createdChat: true,
      changed: true,
    });
    expect(raw.prepare("SELECT kind FROM chats WHERE id = 'chat'").get()).toEqual({
      kind: "voice",
    });

    expect(
      voiceChats.syncVoiceHistory({
        chatId: "chat",
        userId: "user",
        projectId: null,
        allowCreate: true,
        history: [user],
      }),
    ).toMatchObject({ status: "ok", createdChat: false, changed: false });

    const updated = { ...user, parts: [{ type: "text" as const, text: "Hello there" }] };
    expect(
      voiceChats.syncVoiceHistory({
        chatId: "chat",
        userId: "user",
        projectId: null,
        allowCreate: true,
        history: [updated],
      }),
    ).toMatchObject({ status: "ok", changed: true });
    expect(raw.prepare("SELECT content FROM messages_fts").get()).toEqual({
      content: "Hello there",
    });
  });

  it("reads title context from the first persisted user message", async () => {
    raw.exec(`
      INSERT INTO chats (id, user_id, kind) VALUES ('chat', 'user', 'voice');
      INSERT INTO messages (id, chat_id, role, parts) VALUES
        ('assistant', 'chat', 'assistant', '[{"type":"text","text":"Earlier assistant"}]'),
        ('first-user', 'chat', 'user', '[{"type":"text","text":"First topic"}]'),
        ('second-user', 'chat', 'user', '[{"type":"text","text":"Follow-up"}]');
    `);

    await expect(
      chatQueries.getChatTitleContext("chat", "user"),
    ).resolves.toEqual({
      title: null,
      firstUserParts: [{ type: "text", text: "First topic" }],
    });
    await expect(
      chatQueries.getChatTitleContext("chat", "other"),
    ).resolves.toBeNull();
  });

  it("never converts a text chat or another user's chat", () => {
    raw.exec(`
      INSERT INTO chats (id, user_id, kind) VALUES ('text-chat', 'user', 'text');
      INSERT INTO chats (id, user_id, kind) VALUES ('other-chat', 'other', 'voice');
    `);
    const history = [
      {
        id: "message",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "No" }],
      },
    ];

    expect(
      voiceChats.syncVoiceHistory({
        chatId: "text-chat",
        userId: "user",
        projectId: null,
        allowCreate: false,
        history,
      }),
    ).toEqual({ status: "wrong-kind" });
    expect(
      voiceChats.syncVoiceHistory({
        chatId: "other-chat",
        userId: "user",
        projectId: null,
        allowCreate: false,
        history,
      }),
    ).toEqual({ status: "not-found" });
  });

  it("does not partially create a chat when a message id belongs elsewhere", () => {
    raw.exec(`
      INSERT INTO chats (id, user_id, kind) VALUES ('existing', 'other', 'voice');
      INSERT INTO messages (id, chat_id, role, parts)
      VALUES ('taken', 'existing', 'user', '[{"type":"text","text":"Other"}]');
    `);

    expect(
      voiceChats.syncVoiceHistory({
        chatId: "new-chat",
        userId: "user",
        projectId: null,
        allowCreate: true,
        history: [
          {
            id: "safe",
            role: "user",
            parts: [{ type: "text", text: "Hello" }],
          },
          {
            id: "taken",
            role: "assistant",
            parts: [{ type: "text", text: "No" }],
          },
        ],
      }),
    ).toEqual({ status: "not-found" });
    expect(
      raw.prepare("SELECT id FROM chats WHERE id = 'new-chat'").get(),
    ).toBeUndefined();
    expect(
      raw.prepare("SELECT id FROM messages WHERE id = 'safe'").get(),
    ).toBeUndefined();
  });
});
