import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const databasePath = path.join(
  os.tmpdir(),
  `overtchat-user-roles-${process.pid}-${Date.now()}.db`,
);
process.env.DATABASE_URL = databasePath;

const raw = new Database(databasePath);
raw.pragma("foreign_keys = ON");
raw.exec(`
  CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE session (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
  );
`);

let repository: typeof import("./users");

beforeAll(async () => {
  repository = await import("./users");
});

beforeEach(() => {
  raw.exec(`
    DELETE FROM session;
    DELETE FROM user;
    INSERT INTO user (id, name, email, role, updated_at) VALUES
      ('admin-a', 'Admin A', 'admin-a@example.com', 'admin', 1),
      ('admin-b', 'Admin B', 'admin-b@example.com', 'admin', 1),
      ('member', 'Member', 'member@example.com', 'user', 1);
    INSERT INTO session (id, user_id) VALUES
      ('member-session', 'member'),
      ('admin-b-session', 'admin-b');
  `);
});

afterAll(() => {
  raw.close();
  fs.rmSync(databasePath, { force: true });
});

describe("user role persistence", () => {
  it("changes roles and revokes the target user's sessions", () => {
    expect(
      repository.changeUserRole("admin-a", "member", "admin"),
    ).toMatchObject({
      status: "updated",
      user: { id: "member", role: "admin" },
    });
    expect(
      raw.prepare("SELECT count(*) AS count FROM session WHERE user_id = ?")
        .get("member"),
    ).toEqual({ count: 0 });
  });

  it("does not allow an administrator to change their own role", () => {
    expect(
      repository.changeUserRole("admin-a", "admin-a", "user"),
    ).toEqual({ status: "self" });
  });

  it("keeps at least one administrator", () => {
    expect(
      repository.changeUserRole("admin-a", "admin-b", "user"),
    ).toMatchObject({ status: "updated" });
    expect(
      repository.changeUserRole("member", "admin-a", "user"),
    ).toEqual({ status: "last_admin" });
  });
});
