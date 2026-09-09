import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", async () => {
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { registerSqliteFunctions } = await import("./sqlite-functions");
  const sqlite = new Database(":memory:");
  registerSqliteFunctions(sqlite);
  return { db: drizzle(sqlite) };
});

import { db } from "@/lib/db/client";
import { listLibrary } from "./library";

const raw = db.$client;
raw.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE chats (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY, chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL, parts TEXT NOT NULL
  );
  CREATE TABLE uploads (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, filename TEXT NOT NULL,
    media_type TEXT NOT NULL, category TEXT NOT NULL, size INTEGER NOT NULL,
    page_count INTEGER, extracted_text TEXT, truncated INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);
afterAll(() => raw.close());
beforeEach(() => {
  raw.exec("DELETE FROM messages; DELETE FROM chats; DELETE FROM uploads;");
  raw.prepare("INSERT INTO chats VALUES (?, ?)").run("chat-a", "alice");
  raw.prepare("INSERT INTO chats VALUES (?, ?)").run("chat-b", "alice");
  raw.prepare("INSERT INTO chats VALUES (?, ?)").run("bob-chat", "bob");
});

function upload(id: string, user = "alice", filename = `${id}.txt`) {
  raw.prepare(`INSERT INTO uploads VALUES (?, ?, ?, 'text/plain', 'text', 12, NULL, 'private document contents', 0, 1000)`)
    .run(id, user, filename);
  return { type: "file", url: `/api/uploads/${id}`, filename, mediaType: "text/plain" };
}
function message(chat: string, parts: unknown[], role = "user") {
  raw.prepare("INSERT INTO messages VALUES (?, ?, ?, ?)")
    .run(crypto.randomUUID(), chat, role, JSON.stringify(parts));
}

describe("library membership", () => {
  it("lists saved owned file parts once, excluding drafts, tool results and URL mentions", async () => {
    const shared = upload("shared");
    const fetched = upload("fetched");
    const mentioned = upload("mentioned");
    upload("unsent");
    message("chat-a", [shared]);
    message("chat-b", [shared]);
    message("chat-a", [{ type: "text", text: mentioned.url }, { type: "tool-fetch_url", output: { uploadUrl: fetched.url } }]);
    message("chat-a", [fetched], "assistant");
    // Imported messages can contain unexpected JSON values, not only typed parts.
    message("chat-a", [null, "not an object", 4]);
    const result = await listLibrary("alice");
    expect(result.items.map((item) => item.id)).toEqual(["shared"]);
    expect(result.items[0]).toMatchObject({ url: shared.url, createdAt: 1000, size: 12 });
    expect(result.items[0]).not.toHaveProperty("extractedText");
    expect(result.nextCursor).toBeNull();
  });

  it("requires ownership of both the upload and the referencing chat", async () => {
    const alice = upload("alice-file");
    const bob = upload("bob-file", "bob");
    const onlyForeignReference = upload("foreign-reference");
    message("chat-a", [alice, bob]);
    message("bob-chat", [bob, onlyForeignReference]);
    expect((await listLibrary("alice")).items.map((item) => item.id)).toEqual(["alice-file"]);
    expect((await listLibrary("bob")).items.map((item) => item.id)).toEqual(["bob-file"]);
    expect((await listLibrary("outsider")).items).toEqual([]);
  });

  it("keeps reused files until their last referencing chat is deleted, without waiting for disk cleanup", async () => {
    const shared = upload("shared");
    message("chat-a", [shared, upload("exclusive")]);
    message("chat-b", [shared]);
    raw.prepare("DELETE FROM chats WHERE id = ?").run("chat-a");
    expect((await listLibrary("alice")).items.map((item) => item.id)).toEqual(["shared"]);
    raw.prepare("DELETE FROM chats WHERE id = ?").run("chat-b");
    expect((await listLibrary("alice")).items).toEqual([]);
    expect(raw.prepare("SELECT count(*) AS count FROM uploads").get()).toEqual({ count: 2 });
  });

  it("removes files when their attachment is edited out of saved history", async () => {
    message("chat-a", [upload("edited")]);
    raw.prepare("UPDATE messages SET parts = ?").run(JSON.stringify([{ type: "text", text: "replacement" }]));
    expect((await listLibrary("alice")).items).toEqual([]);
  });

  it("searches literal filenames case-insensitively and paginates equal timestamps deterministically", async () => {
    for (let i = 0; i < 45; i++) message("chat-a", [upload(`file-${String(i).padStart(2, "0")}`)]);
    message("chat-a", [upload("special", "alice", "Report_100%.TXT")]);
    expect((await listLibrary("alice", "report_100%")).items.map((item) => item.id)).toEqual(["special"]);
    expect((await listLibrary("alice", "' OR 1=1 --")).items).toEqual([]);
    const first = await listLibrary("alice", "file-");
    expect(first.items).toHaveLength(40);
    expect(JSON.parse(first.nextCursor!)).toEqual({ createdAt: 1000, id: "file-05" });
    const second = await listLibrary("alice", "file-", JSON.parse(first.nextCursor!));
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(45);
  });

  it("does not skip or repeat surviving files when chats disappear and uploads arrive between pages", async () => {
    for (let i = 0; i < 45; i++) {
      message(i >= 5 ? "chat-a" : "chat-b", [upload(`file-${String(i).padStart(2, "0")}`)]);
    }
    const first = await listLibrary("alice");
    // Delete every first-page reference, including the cursor's own file.
    raw.prepare("DELETE FROM chats WHERE id = ?").run("chat-a");
    raw.prepare("DELETE FROM uploads WHERE id = ?").run("file-05");
    message("chat-b", [upload("new-file")]);
    raw.prepare("UPDATE uploads SET created_at = 2000 WHERE id = ?").run("new-file");
    const second = await listLibrary("alice", "", JSON.parse(first.nextCursor!));
    expect(second.items.map((item) => item.id)).toEqual(["file-04", "file-03", "file-02", "file-01", "file-00"]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ["RÉSUMÉ.pdf", "résumé"],
    ["Re\u0301sume\u0301.pdf", "RÉSUMÉ"],
    ["Résumé.pdf", "re\u0301sume\u0301"],
    ["ПРОЕКТ.txt", "проект"],
  ])("matches Unicode filename %s with %s", async (filename, query) => {
    message("chat-a", [upload("unicode", "alice", filename)]);
    expect((await listLibrary("alice", query)).items.map((item) => item.id)).toEqual(["unicode"]);
  });
});
