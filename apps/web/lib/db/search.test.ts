import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-search-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.exec(`
  CREATE TABLE chats (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    title TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    message_id UNINDEXED,
    chat_id UNINDEXED,
    user_id UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
  );
`);

let searchChats: typeof import("./search").searchChats;

beforeAll(async () => {
  ({ searchChats } = await import("./search"));
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM messages_fts;
    DELETE FROM chats;
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

function seedChat(id: string, userId: string, title: string | null, updatedAt: number) {
  raw
    .prepare(
      `INSERT INTO chats (id, user_id, title, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, userId, title, updatedAt);
}

function seedMessage(
  messageId: string,
  chatId: string,
  userId: string,
  content: string,
) {
  raw
    .prepare(
      `INSERT INTO messages_fts (content, message_id, chat_id, user_id) VALUES (?, ?, ?, ?)`,
    )
    .run(content, messageId, chatId, userId);
}

describe("searchChats", () => {
  it("returns one highlighted message hit per chat, best match first", async () => {
    seedChat("chat-a", "user", "Doctor visit", 10);
    seedChat("chat-b", "user", "Groceries", 20);
    seedMessage("a1", "chat-a", "user", "Remember to refill the medication on Monday");
    seedMessage("a2", "chat-a", "user", "medication medication medication");
    seedMessage("b1", "chat-b", "user", "Buy some medicine for the trip");

    const hits = await searchChats("user", "medic");

    expect(hits.map((hit) => hit.chatId).sort()).toEqual(["chat-a", "chat-b"]);
    const chatA = hits.find((hit) => hit.chatId === "chat-a");
    expect(chatA?.messageId).toBe("a2");
    expect(chatA?.snippet).toContain("<mark>medication</mark>");
    expect(chatA?.title).toBe("Doctor visit");
    expect(chatA?.updatedAt).toBe(10);
    const chatB = hits.find((hit) => hit.chatId === "chat-b");
    expect(chatB?.messageId).toBe("b1");
    expect(chatB?.snippet).toContain("<mark>medicine</mark>");
  });

  it("scopes message hits to the requesting user", async () => {
    seedChat("mine", "user", null, 1);
    seedChat("theirs", "other", null, 2);
    seedMessage("m1", "mine", "user", "shared keyword here");
    seedMessage("t1", "theirs", "other", "shared keyword there");

    const hits = await searchChats("user", "shared");

    expect(hits.map((hit) => hit.chatId)).toEqual(["mine"]);
  });

  it("falls back to title matches and dedupes against message hits", async () => {
    seedChat("both", "user", "Budget planning", 5);
    seedChat("title-only", "user", "Budget for the trip", 9);
    seedMessage("m1", "both", "user", "the budget spreadsheet is attached");

    const hits = await searchChats("user", "budget");

    expect(hits.map((hit) => hit.chatId)).toEqual(["both", "title-only"]);
    expect(hits[0].snippet).toContain("<mark>budget</mark>");
    expect(hits[1].snippet).toBeNull();
    expect(hits[1].messageId).toBeNull();
  });

  it("returns nothing for queries shorter than two characters", async () => {
    seedChat("chat", "user", "a", 1);
    seedMessage("m1", "chat", "user", "a");

    expect(await searchChats("user", "a")).toEqual([]);
    expect(await searchChats("user", "   ")).toEqual([]);
  });

  it("treats FTS query syntax in user input as literal text", async () => {
    seedChat("chat", "user", null, 1);
    seedMessage("m1", "chat", "user", "nothing to see");

    await expect(searchChats("user", 'AND OR NOT "(')).resolves.toEqual([]);
  });
});
