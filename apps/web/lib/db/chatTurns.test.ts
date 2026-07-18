import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-chat-turns-${process.pid}-${Date.now()}.db`,
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
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    message_id UNINDEXED,
    chat_id UNINDEXED,
    user_id UNINDEXED
  );
  CREATE TRIGGER messages_fts_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE message_id = old.id;
  END;
`);

let chatTurns: typeof import("./chatTurns");

beforeAll(async () => {
  chatTurns = await import("./chatTurns");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM messages;
    DELETE FROM messages_fts;
    DELETE FROM chats;
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

function seedChat() {
  raw
    .prepare(
      `INSERT INTO chats (id, user_id, project_id, title, active_stream_id)
     VALUES ('chat', 'user', NULL, NULL, NULL)`,
    )
    .run();
  const insertMessage = raw.prepare(
    `INSERT INTO messages (id, chat_id, role, parts, created_at)
     VALUES (?, 'chat', ?, ?, ?)`,
  );
  insertMessage.run(
    "before",
    "user",
    JSON.stringify([{ type: "text", text: "Before" }]),
    1_000,
  );
  insertMessage.run(
    "edit",
    "user",
    JSON.stringify([{ type: "text", text: "Original" }]),
    2_000,
  );
  insertMessage.run(
    "assistant",
    "assistant",
    JSON.stringify([{ type: "text", text: "Old answer" }]),
    2_000,
  );
}

function messageIds(): string[] {
  return raw
    .prepare("SELECT id FROM messages WHERE chat_id = 'chat' ORDER BY rowid")
    .all()
    .map((row) => (row as { id: string }).id);
}

describe("transactional chat turns", () => {
  it("rolls back branch deletion when replacement insertion fails", () => {
    seedChat();

    expect(() =>
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "stream",
        staleStreamId: null,
        truncateFromMessageId: "edit",
        userMessage: {
          id: "before",
          parts: [{ type: "text", text: "Duplicate id" }],
        },
      }),
    ).toThrow();

    expect(messageIds()).toEqual(["before", "edit", "assistant"]);
    expect(
      raw
        .prepare("SELECT active_stream_id AS id FROM chats WHERE id = 'chat'")
        .get(),
    ).toEqual({ id: null });
  });

  it("atomically replaces an edited branch and claims the stream", () => {
    seedChat();

    expect(
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "stream",
        staleStreamId: null,
        truncateFromMessageId: "edit",
        userMessage: {
          id: "edit",
          parts: [{ type: "text", text: "Edited" }],
        },
      }),
    ).toBe("committed");

    expect(messageIds()).toEqual(["before", "edit"]);
    expect(
      raw
        .prepare("SELECT active_stream_id AS id FROM chats WHERE id = 'chat'")
        .get(),
    ).toEqual({ id: "stream" });
    expect(
      raw.prepare("SELECT parts FROM messages WHERE id = 'edit'").get(),
    ).toEqual({ parts: JSON.stringify([{ type: "text", text: "Edited" }]) });
  });

  it("prevents a concurrent claim and completes the owning stream", () => {
    expect(
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "stream-one",
        staleStreamId: null,
        userMessage: {
          id: "user-message",
          parts: [{ type: "text", text: "Hello" }],
        },
      }),
    ).toBe("committed");

    expect(
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "stream-two",
        staleStreamId: null,
        userMessage: {
          id: "second-user-message",
          parts: [{ type: "text", text: "Again" }],
        },
      }),
    ).toBe("stream-active");

    expect(
      chatTurns.completeChatStream({
        chatId: "chat",
        streamId: "stream-one",
        assistantMessage: {
          id: "assistant-message",
          parts: [{ type: "text", text: "Hi" }],
        },
      }),
    ).toBe(true);
    expect(
      raw
        .prepare("SELECT active_stream_id AS id FROM chats WHERE id = 'chat'")
        .get(),
    ).toEqual({ id: null });
    expect(messageIds()).toEqual(["user-message", "assistant-message"]);
    expect(
      raw.prepare("SELECT message_id FROM messages_fts ORDER BY rowid").all(),
    ).toEqual([
      { message_id: "user-message" },
      { message_id: "assistant-message" },
    ]);
  });
});
