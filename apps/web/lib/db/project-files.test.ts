import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROJECT_FILES } from "@/lib/project-files";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("./client", () => fixture);
const directory = mkdtempSync(path.join(os.tmpdir(), "overtchat-project-files-"));
vi.stubEnv("DATABASE_URL", path.join(directory, "test.db"));
const raw = new Database(":memory:");
raw.pragma("foreign_keys = ON");
fixture.db = drizzle(raw);
migrate(fixture.db as ReturnType<typeof drizzle>, {
  migrationsFolder: path.resolve("drizzle"),
});
const { addProjectFile, listProjectChatFiles, listProjectFiles, removeProjectFile } =
  await import("./project-files");
const { sweepOrphanedUploads, uploadPath } = await import("./uploads");
const { listLibrary } = await import("./library");

const DAY = 24 * 60 * 60 * 1000;

function upload(id: string, userId = "a", category = "document", createdAt = Date.now()) {
  raw
    .prepare(
      `INSERT INTO uploads (id, user_id, filename, media_type, category, size, extracted_text, created_at)
       VALUES (?, ?, ?, ?, ?, 10, 'text', ?)`,
    )
    .run(id, userId, `${id}.pdf`, category === "image" ? "image/png" : "application/pdf", category, createdAt);
  writeFileSync(uploadPath(id), "bytes");
}

beforeEach(() => {
  raw.exec(`DELETE FROM project_files; DELETE FROM uploads; DELETE FROM chats; DELETE FROM projects; DELETE FROM user;
    INSERT INTO user (id, name, email) VALUES ('a', 'A', 'a@example.test'), ('b', 'B', 'b@example.test');
    INSERT INTO projects (id, user_id, name) VALUES ('p', 'a', 'Project'), ('q', 'b', 'Other');
    INSERT INTO chats (id, user_id, title) VALUES ('c', 'a', 'Framework'), ('theirs', 'b', 'Private');`);
  upload("spec");
  upload("photo", "a", "image");
  upload("foreign", "b");
});

describe("project files", () => {
  it("links an owned upload once and lists it with its source chat", async () => {
    const added = await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec", sourceChatId: "c" });
    expect(added).toMatchObject({
      ok: true,
      created: true,
      file: {
        uploadId: "spec",
        url: "/api/uploads/spec",
        filename: "spec.pdf",
        category: "document",
        sourceChat: { id: "c", title: "Framework" },
      },
    });
    const again = await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec" });
    expect(again).toMatchObject({ ok: true, created: false });

    expect(await listProjectFiles("p", "a")).toHaveLength(1);
    expect(await listProjectFiles("p", "b")).toEqual([]);
    expect(await listProjectChatFiles("p", "a")).toEqual([
      { uploadId: "spec", name: "spec.pdf", mediaType: "application/pdf" },
    ]);
  });

  it("ignores a source chat the caller does not own", async () => {
    const added = await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec", sourceChatId: "theirs" });
    expect(added).toMatchObject({ ok: true, file: { sourceChat: null } });
  });

  it("refuses other users' projects and uploads, images, and the file cap", async () => {
    expect(await addProjectFile({ projectId: "q", userId: "a", uploadId: "spec" })).toEqual({ ok: false, reason: "project-not-found" });
    expect(await addProjectFile({ projectId: "p", userId: "a", uploadId: "foreign" })).toEqual({ ok: false, reason: "upload-not-found" });
    expect(await addProjectFile({ projectId: "p", userId: "a", uploadId: "photo" })).toEqual({ ok: false, reason: "image" });

    for (let i = 0; i < MAX_PROJECT_FILES; i++) {
      upload(`bulk-${i}`);
      raw.prepare("INSERT INTO project_files (project_id, upload_id) VALUES ('p', ?)").run(`bulk-${i}`);
    }
    expect(await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec" })).toEqual({ ok: false, reason: "limit" });
    // Re-adding a linked file never counts against the cap.
    expect(await addProjectFile({ projectId: "p", userId: "a", uploadId: "bulk-0" })).toMatchObject({ ok: true, created: false });
  });

  it("removes only the link, and only for the owner", async () => {
    await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec" });
    expect(await removeProjectFile("p", "b", "spec")).toBe(false);
    expect(await removeProjectFile("p", "a", "spec")).toBe(true);
    expect(await removeProjectFile("p", "a", "spec")).toBe(false);
    expect(raw.prepare("SELECT id FROM uploads WHERE id = 'spec'").get()).toBeTruthy();
  });

  it("keeps project files through the orphan sweep until they are unlinked", async () => {
    upload("old", "a", "document", Date.now() - 2 * DAY);
    upload("stale", "a", "document", Date.now() - 2 * DAY);
    await addProjectFile({ projectId: "p", userId: "a", uploadId: "old" });
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("old"))).toBe(true);
    expect(existsSync(uploadPath("stale"))).toBe(false);
    await removeProjectFile("p", "a", "old");
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("old"))).toBe(false);
  });

  it("deleting the project drops its links and the files become sweepable", async () => {
    await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec" });
    raw.exec("DELETE FROM projects WHERE id = 'p'");
    expect(raw.prepare("SELECT count(*) AS n FROM project_files").get()).toEqual({ n: 0 });
  });

  it("lists project files in the library so they can be attached again", async () => {
    expect((await listLibrary("a")).items).toEqual([]);
    await addProjectFile({ projectId: "p", userId: "a", uploadId: "spec" });
    expect((await listLibrary("a")).items.map((item) => item.id)).toEqual(["spec"]);
    expect((await listLibrary("b")).items).toEqual([]);
  });
});
