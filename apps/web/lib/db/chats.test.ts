import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./client", () => fixture);

const raw = new Database(":memory:");
raw.pragma("foreign_keys = ON");
fixture.db = drizzle(raw);
const migrationsFolder = path.resolve("drizzle");
migrate(fixture.db as ReturnType<typeof drizzle>, { migrationsFolder });
const { getChat, listChats, listChatsByProject, setChatPinned, deleteChat } = await import("./chats");
const { moveChatToProject, deleteProject } = await import("./projects");

afterAll(() => raw.close());
beforeEach(() => {
  raw.exec(`DELETE FROM chats; DELETE FROM projects; DELETE FROM user;
    INSERT INTO user (id, name, email) VALUES
      ('owner', 'Owner', 'owner@example.test'), ('other', 'Other', 'other@example.test');
    INSERT INTO projects (id, user_id, name, instructions) VALUES
      ('project', 'owner', 'Project', 'Keep these instructions');`);
});

function seed(id: string, updatedAt = 1, userId = "owner", projectId: string | null = null) {
  raw.prepare("INSERT INTO chats (id, user_id, title, updated_at, project_id) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, id, updatedAt, projectId);
}

describe("persistent chat pins", () => {
  it("sets explicit state idempotently without changing activity or project membership", async () => {
    seed("chat", 1234, "owner", "project");
    expect((await getChat("chat", "owner"))?.pinned).toBe(false);
    for (const pinned of [true, true, false, false]) {
      expect(await setChatPinned("chat", "owner", pinned)).toBe(true);
      expect(await getChat("chat", "owner")).toMatchObject({
        pinned, projectId: "project", updatedAt: new Date(1234),
      });
    }
  });

  it("never updates another user's chat or inserts a missing chat", async () => {
    seed("private", 1, "other");
    expect(await setChatPinned("private", "owner", true)).toBe(false);
    expect(await setChatPinned("missing", "owner", true)).toBe(false);
    expect((await getChat("private", "other"))?.pinned).toBe(false);
  });

  it("includes all old pins outside the 100-chat window, sorted and deduplicated by activity", async () => {
    seed("old-pin", 1);
    seed("project-pin", 2, "owner", "project");
    seed("other-pin", 3, "other");
    for (let i = 0; i < 110; i++) seed(`recent-${i}`, 1000 + i);
    await setChatPinned("old-pin", "owner", true);
    await setChatPinned("project-pin", "owner", true);
    await setChatPinned("recent-109", "owner", true);
    await setChatPinned("other-pin", "other", true);
    const rows = await listChats("owner");
    expect(rows).toHaveLength(102);
    expect(rows[0].id).toBe("recent-109");
    expect(rows.slice(-2).map((chat) => chat.id)).toEqual(["project-pin", "old-pin"]);
    expect(rows.filter((chat) => chat.id === "recent-109")).toHaveLength(1);
    expect(rows.every((chat) => chat.userId === "owner")).toBe(true);
    await setChatPinned("old-pin", "owner", false);
    expect((await listChats("owner")).some((chat) => chat.id === "old-pin")).toBe(false);
  });

  it("keeps pins through project moves and project deletion, and removes deleted chats", async () => {
    seed("chat");
    await setChatPinned("chat", "owner", true);
    expect(await moveChatToProject("chat", "owner", "project")).toBe(true);
    expect((await listChatsByProject("project", "owner"))[0].pinned).toBe(true);
    await deleteProject("project", "owner");
    expect(await getChat("chat", "owner")).toMatchObject({ pinned: true, projectId: null });
    await deleteChat("chat", "owner");
    expect(await listChats("owner")).toEqual([]);
  });
});

it("upgrades existing chats to unpinned without changing their contents or timestamps", () => {
  const previousFolder = mkdtempSync(path.join(os.tmpdir(), "overtchat-before-pins-"));
  const previousDb = new Database(":memory:");
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 19);
    mkdirSync(path.join(previousFolder, "meta"));
    writeFileSync(path.join(previousFolder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      cpSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previousFolder, `${entry.tag}.sql`));
    }
    const previousDrizzle = drizzle(previousDb);
    migrate(previousDrizzle, { migrationsFolder: previousFolder });
    previousDb.exec(`INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'upgrade@example.test');
      INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES ('existing', 'owner', 'Saved title', 10, 20);`);
    migrate(previousDrizzle, { migrationsFolder });
    expect(previousDb.prepare("SELECT title, pinned, created_at, updated_at FROM chats WHERE id = 'existing'").get())
      .toEqual({ title: "Saved title", pinned: 0, created_at: 10, updated_at: 20 });
    // Re-running startup migrations is safe.
    migrate(previousDrizzle, { migrationsFolder });
  } finally {
    previousDb.close();
    rmSync(previousFolder, { recursive: true, force: true });
  }
});
