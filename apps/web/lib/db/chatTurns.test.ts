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
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT,
    active_stream_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY NOT NULL,
    chat_id TEXT NOT NULL,
    role TEXT NOT NULL,
    parts TEXT NOT NULL,
    metadata TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
  );
  CREATE TABLE generation_usage (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    chat_id TEXT,
    message_id TEXT,
    context TEXT NOT NULL DEFAULT 'chat',
    occurred_at INTEGER NOT NULL,
    provider_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER,
    uncached_input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    total_tokens INTEGER,
    finish_reason TEXT,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
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
let chatDb: typeof import("./chats");

beforeAll(async () => {
  chatTurns = await import("./chatTurns");
  chatDb = await import("./chats");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM generation_usage;
    DELETE FROM messages;
    DELETE FROM messages_fts;
    DELETE FROM chats;
    DELETE FROM user;
    INSERT INTO user (id) VALUES ('user');
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
          metadata: {
            stats: {
              contextTokens: 4_096,
              responseTokens: 128,
            },
          },
        },
        usage: {
          occurredAt: new Date("2026-07-30T12:00:00.000Z"),
          providerId: "anthropic",
          model: "claude-sonnet-4-5",
          inputTokens: 4_096,
          uncachedInputTokens: 1_024,
          outputTokens: 128,
          cacheReadTokens: 3_072,
          cacheWriteTokens: 0,
          totalTokens: 4_224,
          finishReason: "stop",
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
    expect(
      raw.prepare("SELECT metadata FROM messages WHERE id = ?").get(
        "assistant-message",
      ),
    ).toEqual({
      metadata: JSON.stringify({
        stats: {
          contextTokens: 4_096,
          responseTokens: 128,
        },
      }),
    });
    expect(
      raw
        .prepare(
          `SELECT
             id,
             user_id AS userId,
             chat_id AS chatId,
             message_id AS messageId,
             occurred_at AS occurredAt,
             provider_id AS providerId,
             model,
             input_tokens AS inputTokens,
             uncached_input_tokens AS uncachedInputTokens,
             output_tokens AS outputTokens,
             cache_read_tokens AS cacheReadTokens,
             cache_write_tokens AS cacheWriteTokens,
             total_tokens AS totalTokens,
             finish_reason AS finishReason
           FROM generation_usage`,
        )
        .get(),
    ).toEqual({
      id: "stream-one",
      userId: "user",
      chatId: "chat",
      messageId: "assistant-message",
      occurredAt: new Date("2026-07-30T12:00:00.000Z").getTime(),
      providerId: "anthropic",
      model: "claude-sonnet-4-5",
      inputTokens: 4_096,
      uncachedInputTokens: 1_024,
      outputTokens: 128,
      cacheReadTokens: 3_072,
      cacheWriteTokens: 0,
      totalTokens: 4_224,
      finishReason: "stop",
    });
  });

  it("keeps assistant persistence when usage insertion fails", () => {
    expect(
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "stream",
        staleStreamId: null,
        userMessage: {
          id: "user-message",
          parts: [{ type: "text", text: "Hello" }],
        },
      }),
    ).toBe("committed");
    raw
      .prepare(
        `INSERT INTO generation_usage (
          id, user_id, chat_id, occurred_at, provider_id, model
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("stream", "user", "chat", 1_000, "custom", "old-model");

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      chatTurns.completeChatStream({
        chatId: "chat",
        streamId: "stream",
        assistantMessage: {
          id: "assistant-message",
          parts: [{ type: "text", text: "Hi" }],
        },
        usage: {
          occurredAt: new Date(2_000),
          providerId: "custom",
          model: "new-model",
          totalTokens: 10,
        },
      }),
    ).toBe(true);

    expect(messageIds()).toEqual(["user-message", "assistant-message"]);
    expect(
      raw
        .prepare("SELECT active_stream_id AS id FROM chats WHERE id = 'chat'")
        .get(),
    ).toEqual({ id: null });
    expect(
      raw.prepare("SELECT message_id FROM messages_fts ORDER BY rowid").all(),
    ).toEqual([
      { message_id: "user-message" },
      { message_id: "assistant-message" },
    ]);
    expect(
      raw
        .prepare(
          "SELECT model, message_id AS messageId FROM generation_usage WHERE id = ?",
        )
        .get("stream"),
    ).toEqual({ model: "old-model", messageId: null });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[generation-usage]",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("keeps usage when its message branch and chat are deleted", async () => {
    seedChat();
    raw
      .prepare(
        `INSERT INTO generation_usage (
          id, user_id, chat_id, message_id, occurred_at, provider_id, model,
          total_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "old-stream",
        "user",
        "chat",
        "assistant",
        1_000,
        "custom",
        "model",
        50,
      );

    expect(
      chatTurns.commitChatTurn({
        chatId: "chat",
        userId: "user",
        projectId: null,
        streamId: "new-stream",
        staleStreamId: null,
        truncateFromMessageId: "edit",
        userMessage: {
          id: "edit",
          parts: [{ type: "text", text: "Edited" }],
        },
      }),
    ).toBe("committed");
    expect(
      raw
        .prepare(
          "SELECT chat_id AS chatId, message_id AS messageId FROM generation_usage",
        )
        .get(),
    ).toEqual({ chatId: "chat", messageId: null });

    await chatDb.deleteChat("chat", "user");
    expect(
      raw
        .prepare(
          "SELECT chat_id AS chatId, message_id AS messageId FROM generation_usage",
        )
        .get(),
    ).toEqual({ chatId: null, messageId: null });
  });

  it("removes usage when the owning account is deleted", () => {
    seedChat();
    raw
      .prepare(
        `INSERT INTO generation_usage (
          id, user_id, chat_id, occurred_at, provider_id, model
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("stream", "user", "chat", 1_000, "custom", "model");

    raw.prepare("DELETE FROM user WHERE id = ?").run("user");

    expect(
      raw.prepare("SELECT COUNT(*) AS count FROM generation_usage").get(),
    ).toEqual({ count: 0 });
  });

  it("reads persisted metadata through both message loaders", async () => {
    seedChat();
    raw
      .prepare("UPDATE messages SET metadata = ? WHERE id = ?")
      .run(
        JSON.stringify({ stats: { contextTokens: 2_048 } }),
        "assistant",
      );

    await expect(
      chatTurns.getChatMessage("chat", "assistant"),
    ).resolves.toEqual({
      id: "assistant",
      role: "assistant",
      parts: [{ type: "text", text: "Old answer" }],
      metadata: { stats: { contextTokens: 2_048 } },
    });
    await expect(chatDb.getMessages("chat")).resolves.toEqual([
      {
        id: "before",
        role: "user",
        parts: [{ type: "text", text: "Before" }],
      },
      {
        id: "edit",
        role: "user",
        parts: [{ type: "text", text: "Original" }],
      },
      {
        id: "assistant",
        role: "assistant",
        parts: [{ type: "text", text: "Old answer" }],
        metadata: { stats: { contextTokens: 2_048 } },
      },
    ]);
  });
});
