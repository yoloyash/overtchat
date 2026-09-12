import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: auth.getSession } },
}));
const directory = mkdtempSync(path.join(tmpdir(), "overtchat-push-"));
const previousDatabase = process.env.DATABASE_URL;
process.env.DATABASE_URL = path.join(directory, "chat.db");
let db: typeof import("@/lib/db/client").db;
let schema: typeof import("@/lib/db/schema");
let repository: typeof import("@/lib/db/pushNotifications");
let worker: typeof import("./worker");
let chat: typeof import("./chat");
let route: typeof import("@/app/api/push-devices/route");
const id = "00000000-0000-4000-8000-000000000001";
const input = {
  id,
  token: "ExpoPushToken[device-one]",
  chats: true,
  agents: true,
  previews: true,
};
const fetchMock = vi.fn();
function request(method: string, body: unknown) {
  return new Request("http://localhost/api/push-devices", {
    method,
    body: JSON.stringify(body),
  });
}
function jobs() {
  return db.select().from(schema.pushJobs).all();
}
function register() {
  repository.registerPushDevice("alice", "login-alice", input);
}
function enqueue() {
  chat.notifyChatComplete("alice", "chat", "generation", [
    { type: "text", text: "The answer" },
  ]);
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db/client"));
  schema = await import("@/lib/db/schema");
  (await import("@/lib/db/migrate")).runMigrations();
  repository = await import("@/lib/db/pushNotifications");
  worker = await import("./worker");
  chat = await import("./chat");
  route = await import("@/app/api/push-devices/route");
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockReset()
    .mockResolvedValue(
      Response.json({ data: { status: "ok", id: "receipt" } }),
    );
  db.delete(schema.user).run();
  for (const userId of ["alice", "bob"]) {
    db.insert(schema.user)
      .values({
        id: userId,
        name: userId,
        email: `${userId}@test.invalid`,
        role: "admin",
      })
      .run();
    db.insert(schema.session)
      .values({
        id: `login-${userId}`,
        token: `session-${userId}`,
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        updatedAt: new Date(),
      })
      .run();
  }
  db.insert(schema.chats).values({ id: "chat", userId: "alice" }).run();
  db.insert(schema.hostConnectors)
    .values({
      id: "connector",
      userId: "alice",
      name: "Host",
      tokenHash: "hash",
    })
    .run();
  db.insert(schema.agentHosts)
    .values({
      id: "host",
      connectorId: "connector",
      userId: "alice",
      name: "Host",
      transport: "local",
    })
    .run();
  db.insert(schema.agentConnections)
    .values({
      id: "connection",
      hostId: "host",
      provider: "codex",
      executable: "codex",
    })
    .run();
  db.insert(schema.agentWorkspaces)
    .values({
      id: "workspace",
      connectionId: "connection",
      path: "/tmp",
      name: "Project",
    })
    .run();
  db.insert(schema.agentSessions)
    .values({
      id: "agent",
      workspaceId: "workspace",
      providerSessionId: "p",
      providerSessionPath: "/p",
      name: "Fix tests",
    })
    .run();
  auth.getSession.mockResolvedValue({
    user: { id: "alice" },
    session: { id: "login-alice" },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(() => {
  db.$client.close();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  rmSync(directory, { recursive: true, force: true });
});

describe("push registration and delivery through the production migration", () => {
  it("requires authentication and validates tokens and preferences", async () => {
    auth.getSession.mockResolvedValueOnce(null);
    expect((await route.POST(request("POST", input))).status).toBe(401);
    auth.getSession.mockResolvedValueOnce(null);
    expect((await route.DELETE(request("DELETE", { id }))).status).toBe(401);
    expect(
      (
        await route.POST(
          request("POST", { ...input, token: "https://attacker.invalid" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await route.POST(request("POST", { ...input, chats: "true" }))).status,
    ).toBe(400);
    expect((await route.POST(request("POST", input))).status).toBe(200);
    expect(db.select().from(schema.pushDevices).get()?.sessionId).toBe(
      "login-alice",
    );
  });
  it("does not let another account alter or delete a registration", async () => {
    register();
    auth.getSession.mockResolvedValue({
      user: { id: "bob" },
      session: { id: "login-bob" },
    });
    expect((await route.POST(request("POST", input))).status).toBe(404);
    await route.DELETE(request("DELETE", { id }));
    expect(db.select().from(schema.pushDevices).get()?.userId).toBe("alice");
  });
  it("replaces the previous account registration for the same device token", () => {
    register();
    enqueue();
    repository.registerPushDevice("bob", "login-bob", {
      ...input,
      id: crypto.randomUUID(),
    });
    expect(db.select().from(schema.pushDevices).all()).toHaveLength(1);
    expect(jobs()).toHaveLength(0);
  });
  it("sends only the owning user's enabled devices, once per generation, with visible text only", async () => {
    register();
    repository.registerPushDevice("bob", "login-bob", {
      ...input,
      id: crypto.randomUUID(),
      token: "ExpoPushToken[bob]",
    });
    const parts = [
      { type: "reasoning", text: "secret reasoning" },
      { type: "text", text: "Hello\nworld" },
      { type: "tool-result", text: "secret tool output" },
    ];
    chat.notifyChatComplete("alice", "chat", "g", parts);
    chat.notifyChatComplete("alice", "chat", "g", parts);
    expect(jobs()).toHaveLength(1);
    await worker.flushPushNotifications();
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      to: input.token,
      title: "Your response is ready",
      body: "Hello world",
      data: { kind: "chat", targetId: "chat", registrationId: id },
    });
    expect(jobs()[0].receiptId).toBe("receipt");
  });
  it("keeps preview text out of the queue when previews are disabled", async () => {
    repository.registerPushDevice("alice", "login-alice", {
      ...input,
      previews: false,
    });
    enqueue();
    expect(jobs()[0].body).toBe("");
    await worker.flushPushNotifications();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).body).toBe(
      "Tap to view your response.",
    );
  });
  it("rechecks preview preferences before delivery", async () => {
    register();
    enqueue();
    repository.registerPushDevice("alice", "login-alice", {
      ...input,
      previews: false,
    });
    await worker.flushPushNotifications();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).body).not.toContain(
      "The answer",
    );
  });
  it.each(["logout", "expired", "disabled", "deleted", "banned"])(
    "does not deliver after %s",
    async (action) => {
      register();
      enqueue();
      if (action === "logout")
        db.delete(schema.session)
          .where(eq(schema.session.id, "login-alice"))
          .run();
      if (action === "expired")
        db.update(schema.session)
          .set({ expiresAt: new Date(0) })
          .run();
      if (action === "disabled")
        repository.registerPushDevice("alice", "login-alice", {
          ...input,
          chats: false,
        });
      if (action === "deleted") db.delete(schema.chats).run();
      if (action === "banned")
        db.update(schema.user).set({ banned: true }).run();
      await worker.flushPushNotifications();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(jobs()).toHaveLength(0);
    },
  );
  it("retries transient failure without losing the queued notification", async () => {
    register();
    enqueue();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await worker.flushPushNotifications();
    expect(jobs()[0]).toMatchObject({ attempts: 1, receiptId: null });
    await worker.flushPushNotifications();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    await worker.flushPushNotifications();
    expect(jobs()[0].receiptId).toBe("receipt");
  });
  it("checks receipts and removes invalid device registrations", async () => {
    register();
    enqueue();
    await worker.flushPushNotifications();
    vi.advanceTimersByTime(15 * 60_000);
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: {
          receipt: {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
    );
    await worker.flushPushNotifications();
    expect(fetchMock.mock.calls[1][0]).toContain("getReceipts");
    expect(db.select().from(schema.pushDevices).all()).toHaveLength(0);
    expect(jobs()).toHaveLength(0);
  });
  it("sends generic agent idle alerts and cancels queued ones on resumed work", async () => {
    register();
    repository.enqueueAgentIdle("agent");
    repository.cancelAgentPush("agent");
    expect(jobs()).toHaveLength(0);
    repository.enqueueAgentIdle("agent");
    await worker.flushPushNotifications();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      title: "Agent is idle",
      body: "Fix tests · Tap to view the session.",
      data: { kind: "agent", targetId: "agent" },
    });
  });
  it("does not deliver agent notifications after admin access is revoked", async () => {
    register();
    repository.enqueueAgentIdle("agent");
    db.update(schema.user)
      .set({ role: "user" })
      .where(eq(schema.user.id, "alice"))
      .run();
    await worker.flushPushNotifications();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
