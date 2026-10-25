import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  cpSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({
  db: null as unknown,
  userId: "owner" as string | null,
}));
vi.mock("./client", () => fixture);
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () =>
        fixture.userId ? { user: { id: fixture.userId } } : null,
    },
  },
}));

const directory = mkdtempSync(path.join(os.tmpdir(), "overtchat-sharing-"));
vi.stubEnv("DATABASE_URL", path.join(directory, "test.db"));
const raw = new Database(":memory:");
raw.pragma("foreign_keys = ON");
fixture.db = drizzle(raw);
migrate(fixture.db as ReturnType<typeof drizzle>, {
  migrationsFolder: path.resolve("drizzle"),
});
const shares = await import("./chatShares");
const { sweepOrphanedUploads, uploadPath } = await import("./uploads");
const ownerRoute = await import("@/app/api/chat/[id]/share/route");
const publicRoute = await import("@/app/api/share/[id]/route");
const fileRoute = await import("@/app/api/share/[id]/files/[fileId]/route");
const { limitShareRead } = await import("@/lib/share-rate-limit");

afterAll(() => {
  raw.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
beforeEach(() => {
  fixture.userId = "owner";
  raw.exec(`DELETE FROM user;
    INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@test.local'), ('other', 'Other', 'other@test.local');
    INSERT INTO chats (id, user_id, title) VALUES ('chat', 'owner', 'Shared title'), ('other-chat', 'other', 'Private title');`);
  message("question", "user", [{ type: "text", text: "Question" }]);
  message("answer", "assistant", [{ type: "text", text: "Answer" }]);
});

function readAll(id: string) {
  let page = shares.readChatShare(id)!;
  const messages = [...page.messages];
  while (page.nextCursor) {
    page = shares.readChatShare(id, page.nextCursor)!;
    messages.push(...page.messages);
  }
  return messages;
}

function message(
  id: string,
  role: string,
  parts: unknown[],
  metadata?: unknown,
) {
  raw
    .prepare(
      "INSERT INTO messages (id, chat_id, role, parts, metadata, created_at) VALUES (?, 'chat', ?, ?, ?, 1)",
    )
    .run(
      id,
      role,
      JSON.stringify(parts),
      metadata ? JSON.stringify(metadata) : null,
    );
}

function upload(id = "image", userId = "owner", mediaType = "image/png") {
  raw
    .prepare(
      "INSERT INTO uploads (id, user_id, filename, media_type, category, size, created_at) VALUES (?, ?, ?, ?, 'image', 4, 1)",
    )
    .run(id, userId, `${id}.png`, mediaType);
  writeFileSync(uploadPath(id), "test");
}

describe("shared conversation persistence", () => {
  it("freezes the whole ordered transcript and title until an explicit update", () => {
    for (let i = 0; i < 120; i++)
      message(`long-${i}`, "assistant", [
        { type: "text", text: `Message ${i}` },
      ]);
    const share = shares.publishChatShare("chat", "owner")!;
    expect(share.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(readAll(share.id)).toHaveLength(122);
    expect(readAll(share.id).at(-1)?.id).toBe("long-119");
    raw.exec(
      "DELETE FROM messages WHERE id = 'answer'; UPDATE chats SET title = 'Edited title' WHERE id = 'chat'",
    );
    message("later", "assistant", [
      { type: "text", text: "Later private answer" },
    ]);
    expect(shares.publishChatShare("chat", "owner")?.id).toBe(share.id);
    const frozen = shares.readChatShare(share.id)!;
    expect(frozen.title).toBe("Shared title");
    expect(frozen.messages.some((m) => m.id === "answer")).toBe(true);
    expect(frozen.messages.some((m) => m.id === "later")).toBe(false);
    expect(shares.publishChatShare("chat", "owner", true)?.id).toBe(share.id);
    expect(shares.readChatShare(share.id)?.title).toBe("Edited title");
    expect(readAll(share.id).at(-1)?.id).toBe("later");
  });

  it("pages snapshots consistently and preserves form state submitted on a later page", () => {
    for (let i = 0; i < 110; i++)
      message(`page-${i}`, "assistant", [{ type: "text", text: `Page ${i}` }]);
    message("late-form", "user", [{ type: "text", text: "Submit" }], {
      openuiAction: {
        messageId: "answer",
        toolCallId: "form",
        message: "Submit",
        formState: { city: "Kyoto" },
      },
    });
    const share = shares.publishChatShare("chat", "owner")!;
    const first = shares.readChatShare(share.id)!;
    expect(first.messages).toHaveLength(50);
    expect(first.messages.at(-1)?.id).toBe("page-47");
    expect(first.formStates).toEqual([
      [JSON.stringify(["answer", "form"]), { city: "Kyoto" }],
    ]);
    const second = shares.readChatShare(share.id, first.nextCursor!)!;
    expect(second.messages[0].id).toBe("page-48");
    expect(second.messages).toHaveLength(50);
    const third = shares.readChatShare(share.id, second.nextCursor!)!;
    expect(third.messages).toHaveLength(13);
    expect(third.nextCursor).toBeNull();
    expect(readAll(share.id).map((m) => m.id)).toHaveLength(113);
    expect(() => shares.readChatShare(share.id, "garbage")).toThrow(
      "Invalid page cursor",
    );
    expect(() =>
      shares.readChatShare(
        share.id,
        first.nextCursor!.replace(":50", ":99999"),
      ),
    ).toThrow("Invalid page cursor");
    shares.publishChatShare("chat", "owner", true);
    expect(() => shares.readChatShare(share.id, first.nextCursor!)).toThrow(
      "was updated",
    );
    shares.revokeChatShare("chat", "owner");
    expect(shares.readChatShare(share.id, second.nextCursor!)).toBeNull();
  });

  it("publishes code examples without granting attachment access", () => {
    upload("example");
    const text =
      'Literal /api/uploads/missing and `/api/uploads/example`.\n\n```js\nfetch("/api/uploads/missing")\n```';
    message("code-example", "assistant", [{ type: "text", text }]);
    const share = shares.publishChatShare("chat", "owner")!;
    expect(shares.readChatShare(share.id)!.messages.at(-1)!.parts).toEqual([
      { type: "text", text },
    ]);
    expect(shares.readSharedUpload(share.id, "example")).toBeNull();
  });

  it("retains rich content and saved form values without replay metadata or hidden parts", () => {
    message("system", "system", [
      { type: "text", text: "Secret system instructions" },
    ]);
    message(
      "rich",
      "assistant",
      [
        {
          type: "text",
          text: "Answer with citations",
          providerMetadata: { secret: "provider-secret" },
        },
        {
          type: "reasoning",
          text: "Visible reasoning",
          state: "done",
          providerMetadata: { encrypted: "private-token" },
        },
        {
          type: "dynamic-tool",
          toolName: "mcp__server__tool",
          toolCallId: "tool",
          state: "output-available",
          input: { query: "lookup" },
          output: { result: "Visible result" },
          callProviderMetadata: { secret: "secret-call" },
        },
        {
          type: "tool-present_openui",
          toolCallId: "form",
          state: "output-available",
          input: { ui: 'root = Text("Hello")', text: "Hello" },
          output: { displayed: true },
        },
        { type: "data-hidden", data: { secret: "hidden-data" } },
      ],
      { secret: "private-metadata" },
    );
    message("form-action", "user", [{ type: "text", text: "Submit" }], {
      openuiAction: {
        messageId: "rich",
        toolCallId: "form",
        message: "Submit",
        formState: { city: "Kyoto" },
        context: { private: "hidden-context" },
      },
      internal: "hidden-metadata",
    });
    const share = shares.publishChatShare("chat", "owner")!;
    const result = shares.readChatShare(share.id)!;
    expect(result.messages.find((m) => m.id === "rich")?.parts).toHaveLength(4);
    expect(result.messages.at(-1)?.metadata).toEqual({
      openuiAction: {
        messageId: "rich",
        toolCallId: "form",
        message: "Submit",
        formState: { city: "Kyoto" },
      },
    });
    const json = JSON.stringify(result);
    for (const hidden of [
      "Secret system",
      "provider-secret",
      "private-token",
      "secret-call",
      "hidden-data",
      "private-metadata",
      "hidden-context",
      "hidden-metadata",
    ])
      expect(json).not.toContain(hidden);
    expect(json).toContain("Visible reasoning");
    expect(json).toContain("Visible result");
  });

  it("authorizes every file, rewrites nested references, and keeps shared files through orphan cleanup", async () => {
    upload();
    upload("unused");
    message("files", "user", [
      { type: "file", mediaType: "image/png", url: "/api/uploads/image" },
    ]);
    message("generated", "assistant", [
      {
        type: "tool-generate_image",
        toolCallId: "image-tool",
        state: "output-available",
        output: { images: [{ url: "/api/uploads/image" }] },
      },
      { type: "text", text: "![image](/api/uploads/image)" },
    ]);
    const share = shares.publishChatShare("chat", "owner")!;
    const json = JSON.stringify(shares.readChatShare(share.id));
    expect(json).not.toContain("/api/uploads/");
    expect(json).toContain(`/api/share/${share.id}/files/image`);
    expect(shares.readSharedUpload(share.id, "unused")).toBeNull();
    expect(shares.readSharedUpload("unknown", "image")).toBeNull();
    raw.exec("DELETE FROM messages WHERE id IN ('files', 'generated')");
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("image"))).toBe(true);
    expect(existsSync(uploadPath("unused"))).toBe(false);
    shares.revokeChatShare("chat", "owner");
    expect(shares.readSharedUpload(share.id, "image")).toBeNull();
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("image"))).toBe(false);
  });

  it("authorizes and retains images referenced only by fetch_url, then revokes them on update", async () => {
    upload("fetched");
    message("fetched-image", "assistant", [
      {
        type: "tool-fetch_url",
        toolCallId: "fetch",
        state: "output-available",
        input: { url: "https://example.com/photo.png" },
        output: {
          kind: "image",
          url: "https://example.com/photo.png",
          uploadUrl: "/api/uploads/fetched",
          filename: "photo.png",
          contentType: "image/png",
          byteLength: 4,
        },
      },
    ]);
    const share = shares.publishChatShare("chat", "owner")!;
    expect(shares.readSharedUpload(share.id, "fetched")).not.toBeNull();
    expect(JSON.stringify(shares.readChatShare(share.id))).toContain(
      `/api/share/${share.id}/files/fetched`,
    );
    raw.exec("DELETE FROM messages WHERE id = 'fetched-image'");
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("fetched"))).toBe(true);
    shares.publishChatShare("chat", "owner", true);
    expect(shares.readSharedUpload(share.id, "fetched")).toBeNull();
    await sweepOrphanedUploads();
    expect(existsSync(uploadPath("fetched"))).toBe(false);
  });

  it("rejects foreign/missing attachments atomically without replacing an existing share", () => {
    const share = shares.publishChatShare("chat", "owner")!;
    upload("foreign", "other");
    message("forged", "user", [
      { type: "file", url: "/api/uploads/foreign", mediaType: "image/png" },
    ]);
    expect(() => shares.publishChatShare("chat", "owner", true)).toThrow(
      "attachment is unavailable",
    );
    expect(shares.readChatShare(share.id)?.messages).toHaveLength(2);
    expect(shares.readSharedUpload(share.id, "foreign")).toBeNull();
    raw.exec("DELETE FROM uploads WHERE id = 'foreign'");
    expect(() => shares.publishChatShare("chat", "owner", true)).toThrow(
      "attachment is unavailable",
    );
  });

  it("replaces file membership on update without leaving previously shared files public", () => {
    upload("first");
    upload("second");
    message("attachment", "user", [
      { type: "file", url: "/api/uploads/first", mediaType: "image/png" },
    ]);
    const share = shares.publishChatShare("chat", "owner")!;
    raw
      .prepare("UPDATE messages SET parts = ? WHERE id = 'attachment'")
      .run(
        JSON.stringify([
          { type: "file", url: "/api/uploads/second", mediaType: "image/png" },
        ]),
      );
    expect(shares.readSharedUpload(share.id, "first")).not.toBeNull();
    expect(shares.readSharedUpload(share.id, "second")).toBeNull();
    shares.publishChatShare("chat", "owner", true);
    expect(shares.readSharedUpload(share.id, "first")).toBeNull();
    expect(shares.readSharedUpload(share.id, "second")).not.toBeNull();
  });

  it("restricts ownership and cascades chat/account deletion; re-sharing uses a new token", () => {
    expect(shares.publishChatShare("chat", "other")).toBeNull();
    const first = shares.publishChatShare("chat", "owner")!;
    expect(shares.getChatShare("chat", "other")).toBeNull();
    expect(shares.listChatShares("other")).toEqual([]);
    shares.revokeChatShare("chat", "other");
    expect(shares.readChatShare(first.id)).not.toBeNull();
    shares.revokeChatShare("chat", "owner");
    const second = shares.publishChatShare("chat", "owner")!;
    expect(second.id).not.toBe(first.id);
    expect(shares.readChatShare(first.id)).toBeNull();
    raw.exec("DELETE FROM chats WHERE id = 'chat'");
    expect(shares.readChatShare(second.id)).toBeNull();
    raw.exec(
      "INSERT INTO messages (id, chat_id, role, parts) VALUES ('other-message', 'other-chat', 'user', '[{\"type\":\"text\",\"text\":\"hello\"}]')",
    );
    const other = shares.publishChatShare("other-chat", "other")!;
    raw.exec("DELETE FROM user WHERE id = 'other'");
    expect(shares.readChatShare(other.id)).toBeNull();
  });

  it("refuses empty chats and snapshots during an active generation", () => {
    expect(() => shares.publishChatShare("other-chat", "other")).toThrow(
      "Send a message",
    );
    raw.exec("UPDATE chats SET active_stream_id = 'running' WHERE id = 'chat'");
    expect(() => shares.publishChatShare("chat", "owner")).toThrow(
      "Wait for the response",
    );
    expect(shares.getChatShare("chat", "owner")).toBeNull();
  });
});

it("migrates an existing database without changing chats, messages or uploads", () => {
  const folder = mkdtempSync(
    path.join(os.tmpdir(), "overtchat-before-sharing-"),
  );
  const previous = new Database(":memory:");
  previous.pragma("foreign_keys = ON");
  try {
    const migrationsFolder = path.resolve("drizzle");
    const journal = JSON.parse(
      readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"),
    );
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 23,
    );
    mkdirSync(path.join(folder, "meta"));
    writeFileSync(
      path.join(folder, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      cpSync(
        path.join(migrationsFolder, `${entry.tag}.sql`),
        path.join(folder, `${entry.tag}.sql`),
      );
    const previousDb = drizzle(previous);
    migrate(previousDb, { migrationsFolder: folder });
    previous.exec(`INSERT INTO user (id, name, email) VALUES ('owner', 'Owner', 'owner@test.local');
      INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES ('existing', 'owner', 'Existing chat', 10, 20);
      INSERT INTO messages (id, chat_id, role, parts) VALUES ('existing-message', 'existing', 'user', '[{"type":"text","text":"Keep me"}]');
      INSERT INTO uploads (id, user_id, filename, media_type, category, size) VALUES ('existing-file', 'owner', 'test.txt', 'text/plain', 'text', 4);`);
    const before = ["chats", "messages", "uploads"].map((table) =>
      previous.prepare(`SELECT * FROM ${table}`).all(),
    );
    migrate(previousDb, { migrationsFolder });
    migrate(previousDb, { migrationsFolder });
    expect(
      ["chats", "messages", "uploads"].map((table) =>
        previous.prepare(`SELECT * FROM ${table}`).all(),
      ),
    ).toEqual(before);
    expect(previous.prepare("SELECT * FROM chat_shares").all()).toEqual([]);
    expect(previous.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    previous.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

describe("share HTTP boundaries", () => {
  const context = { params: Promise.resolve({ id: "chat" }) };
  it("requires ownership for every management operation and leaves public reads anonymous", async () => {
    fixture.userId = null;
    for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
      expect(
        (
          await ownerRoute[method](
            new Request("http://test/api/chat/chat/share", { method }),
            context,
          )
        ).status,
      ).toBe(401);
    }
    fixture.userId = "other";
    for (const method of ["GET", "POST", "PUT", "DELETE"] as const) {
      expect(
        (
          await ownerRoute[method](
            new Request("http://test/api/chat/chat/share", { method }),
            context,
          )
        ).status,
      ).toBe(404);
    }
    fixture.userId = "owner";
    const response = await ownerRoute.POST(
      new Request("http://test/api/chat/chat/share", { method: "POST" }),
      context,
    );
    expect(response.status).toBe(200);
    const { share } = await response.json();
    fixture.userId = null;
    const publicContext = { params: Promise.resolve({ id: share.id }) };
    const publicResponse = await publicRoute.GET(
      new Request("http://test"),
      publicContext,
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("cache-control")).toBe("no-store");
    expect(publicResponse.headers.get("x-robots-tag")).toContain("noindex");
    const body = await publicResponse.json();
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("chatId");
    shares.revokeChatShare("chat", "owner");
    expect(
      (await publicRoute.GET(new Request("http://test"), publicContext)).status,
    ).toBe(404);
  });

  it("enforces read budgets on both public endpoints even when forwarding headers change", async () => {
    upload("active");
    message("attachment", "user", [
      { type: "file", url: "/api/uploads/active", mediaType: "image/png" },
    ]);
    const share = shares.publishChatShare("chat", "owner")!;
    const params = Promise.resolve({ id: share.id });
    // The limiter's counting is covered in share-rate-limit.test.ts. Spend
    // most of each link budget directly so this test only proves the routes
    // draw from it, whatever the forwarding headers say.
    for (let i = 0; i < 117; i++) expect(limitShareRead(share.id, "page")).toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await publicRoute.GET(
            new Request("http://test", {
              headers: { "x-forwarded-for": `192.0.2.${i}` },
            }),
            { params },
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await publicRoute.GET(
          new Request("http://test", {
            headers: { "x-forwarded-for": "198.51.100.1" },
          }),
          { params },
        )
      ).status,
    ).toBe(429);
    for (let i = 0; i < 597; i++) expect(limitShareRead(share.id, "file")).toBeNull();
    for (let i = 0; i < 3; i++) {
      const response = await fileRoute.GET(
        new Request("http://test", {
          headers: { "x-forwarded-for": `192.0.2.${i}` },
        }),
        { params: Promise.resolve({ id: share.id, fileId: "active" }) },
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("test");
    }
    expect(
      (
        await fileRoute.GET(
          new Request("http://test", {
            headers: { "x-forwarded-for": "198.51.100.1" },
          }),
          { params: Promise.resolve({ id: share.id, fileId: "active" }) },
        )
      ).status,
    ).toBe(429);
  });

  it("serves only share-member files, with revocation-safe caches and safe content disposition", async () => {
    upload("active", "owner", "text/html");
    upload("private");
    message("attachment", "user", [
      { type: "file", url: "/api/uploads/active", mediaType: "text/html" },
    ]);
    const share = shares.publishChatShare("chat", "owner")!;
    fixture.userId = null;
    const read = (fileId: string) =>
      fileRoute.GET(new Request("http://test"), {
        params: Promise.resolve({ id: share.id, fileId }),
      });
    const response = await read("active");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("test");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await read("private")).status).toBe(404);
    expect((await read("../../test.db")).status).toBe(404);
    shares.revokeChatShare("chat", "owner");
    expect((await read("active")).status).toBe(404);
  });
});
