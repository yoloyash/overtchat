import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-personalization-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE user_personalization (
    user_id TEXT PRIMARY KEY NOT NULL,
    enabled INTEGER DEFAULT true NOT NULL,
    preferred_name TEXT,
    occupation TEXT,
    about TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE TABLE memories (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX memories_userId_key_idx ON memories (user_id, key);
  CREATE INDEX memories_userId_updatedAt_idx ON memories (user_id, updated_at);
  INSERT INTO user (id) VALUES ('user-a'), ('user-b');
`);

let service: typeof import("./personalization");

beforeAll(async () => {
  service = await import("./personalization");
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("personalization persistence", () => {
  it("defaults to enabled with an empty profile", async () => {
    await expect(service.getPersonalization("user-a")).resolves.toEqual({
      enabled: true,
      preferredName: null,
      occupation: null,
      about: null,
    });
  });

  it("upserts private profile fields", async () => {
    await expect(
      service.updatePersonalization("user-a", {
        enabled: false,
        preferredName: "Boomer",
        occupation: "Engineer",
        about: "Builds self-hosted software.",
      }),
    ).resolves.toEqual({
      enabled: false,
      preferredName: "Boomer",
      occupation: "Engineer",
      about: "Builds self-hosted software.",
    });
  });

  it("scopes memory CRUD and keyed upserts to one user", async () => {
    const created = service.createMemory("user-a", {
      key: "response_style",
      value: "Prefer concise answers.",
    });
    expect(created).not.toBe("conflict");
    expect(
      service.createMemory("user-a", {
        key: "response_style",
        value: "Duplicate.",
      }),
    ).toBe("conflict");

    service.setMemory("user-a", {
      key: "response_style",
      value: "Prefer direct answers.",
    });
    service.setMemory("user-b", {
      key: "response_style",
      value: "Prefer detailed answers.",
    });

    expect(await service.listMemories("user-a")).toMatchObject([
      { key: "response_style", value: "Prefer direct answers." },
    ]);
    expect(await service.listMemories("user-b")).toMatchObject([
      { key: "response_style", value: "Prefer detailed answers." },
    ]);

    expect(
      await service.deleteMemoryByKey("response_style", "user-a"),
    ).toBe(true);
    expect(await service.listMemories("user-a")).toEqual([]);
    expect(await service.listMemories("user-b")).toHaveLength(1);
  });

  it("rejects writes that would exceed the rendered memory context limit", () => {
    for (let index = 0; index < 7; index += 1) {
      service.setMemory("user-a", {
        key: `large_${index}`,
        value: "x".repeat(500),
      });
    }
    expect(() =>
      service.setMemory("user-a", {
        key: "large_7",
        value: "x".repeat(500),
      }),
    ).toThrow(service.MemoryCapacityError);
  });

  it("cascades personalization data with account deletion", async () => {
    await service.updatePersonalization("user-b", {
      enabled: true,
      preferredName: "B",
      occupation: null,
      about: null,
    });
    raw.prepare("DELETE FROM user WHERE id = ?").run("user-b");
    expect(
      raw.prepare("SELECT * FROM user_personalization WHERE user_id = ?").all("user-b"),
    ).toEqual([]);
    expect(raw.prepare("SELECT * FROM memories WHERE user_id = ?").all("user-b")).toEqual([]);
  });
});
