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
let sender: typeof import("./sender");
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
function register() {
  repository.registerPushDevice("alice", "login-alice", input);
}
function send() {
  return chat.notifyChatComplete("alice", "chat", "generation", [
    { type: "text", text: "The answer" },
  ]);
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db/client"));
  schema = await import("@/lib/db/schema");
  (await import("@/lib/db/migrate")).runMigrations();
  repository = await import("@/lib/db/pushNotifications");
  sender = await import("./sender");
  chat = await import("./chat");
  route = await import("@/app/api/push-devices/route");
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock
    .mockReset()
    .mockImplementation(async (_url, options) =>
      Response.json({
        data: JSON.parse(options.body).map(() => ({
          status: "ok",
          id: "receipt",
        })),
      }),
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
  it("migrates device storage without creating a notification queue", () => {
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    expect(tables.map((table) => table.name)).toContain("push_devices");
    expect(tables.map((table) => table.name)).not.toContain("push_jobs");
  });
  it("replaces the previous account registration for the same device token", async () => {
    register();
    repository.registerPushDevice("bob", "login-bob", {
      ...input,
      id: crypto.randomUUID(),
    });
    expect(db.select().from(schema.pushDevices).all()).toHaveLength(1);
    await send();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only the owning user's enabled devices, with visible text only", async () => {
    register();
    repository.registerPushDevice("bob", "login-bob", {
      ...input,
      id: crypto.randomUUID(),
      token: "ExpoPushToken[bob]",
    });
    repository.registerPushDevice("alice", "login-alice", {
      ...input,
      id: crypto.randomUUID(),
      token: "ExpoPushToken[disabled]",
      chats: false,
    });
    await chat.notifyChatComplete("alice", "chat", "g", [
      { type: "reasoning", text: "secret reasoning" },
      { type: "text", text: "Hello\nworld" },
      { type: "tool-result", text: "secret tool output" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://exp.host/--/api/v2/push/send",
    );
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: input.token,
      title: "Your response is ready",
      body: "Hello world",
      data: {
        kind: "chat",
        targetId: "chat",
        registrationId: id,
        notificationId: `chat:g:${id}`,
      },
    });
  });
  it("does not send a chat belonging to a different user", async () => {
    repository.registerPushDevice("bob", "login-bob", input);
    await chat.notifyChatComplete("bob", "chat", "g", [
      { type: "text", text: "private" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps previews out of the payload when disabled", async () => {
    repository.registerPushDevice("alice", "login-alice", {
      ...input,
      previews: false,
    });
    await send();
    await sender.notifyAgentIdle("agent");
    expect(fetchMock.mock.calls.map((call) => JSON.parse(call[1].body)[0].body))
      .toEqual(["Tap to view your response.", "Tap to view the session."]);
  });
  it.each(["logout", "expired", "disabled", "deleted", "banned"])(
    "does not submit after %s",
    async (action) => {
      register();
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
      await send();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(["network", "http", "malformed", "ticket"])(
    "contains %s failures without retrying or logging private content",
    async (failure) => {
      register();
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        if (failure === "network")
          fetchMock.mockRejectedValueOnce(new Error(input.token));
        if (failure === "http")
          fetchMock.mockResolvedValueOnce(
            new Response(input.token, { status: 503 }),
          );
        if (failure === "malformed")
          fetchMock.mockResolvedValueOnce(Response.json({ data: input.token }));
        if (failure === "ticket")
          fetchMock.mockResolvedValueOnce(
            Response.json({
              data: [{ status: "error", message: input.token }],
            }),
          );
        await expect(send()).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(3_600_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalled();
        expect(JSON.stringify(warning.mock.calls)).not.toContain(input.token);
        expect(JSON.stringify(warning.mock.calls)).not.toContain("The answer");
        expect(db.select().from(schema.pushDevices).all()).toHaveLength(1);
      } finally {
        warning.mockRestore();
      }
    },
  );
  it("does not poll receipts after acceptance", async () => {
    register();
    await send();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["DeviceNotRegistered", "InvalidCredentials"])(
    "handles an immediate %s ticket",
    async (error) => {
      register();
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        fetchMock.mockResolvedValueOnce(
          Response.json({ data: [{ status: "error", details: { error } }] }),
        );
        await send();
        expect(db.select().from(schema.pushDevices).all()).toHaveLength(
          error === "DeviceNotRegistered" ? 0 : 1,
        );
      } finally {
        warning.mockRestore();
      }
    },
  );
  it("does not remove a token refreshed while the send was in flight", async () => {
    register();
    fetchMock.mockImplementationOnce(async () => {
      repository.registerPushDevice("alice", "login-alice", {
        ...input,
        token: "ExpoPushToken[new]",
      });
      return Response.json({
        data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
      });
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await send();
      expect(db.select().from(schema.pushDevices).get()?.token).toBe(
        "ExpoPushToken[new]",
      );
    } finally {
      warning.mockRestore();
    }
  });
  it("batches at most 100 devices and continues if another batch fails", async () => {
    for (let i = 0; i < 101; i++) {
      repository.registerPushDevice("alice", "login-alice", {
        ...input,
        id: crypto.randomUUID(),
        token: `ExpoPushToken[device-${i}]`,
      });
    }
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await send();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).length),
      ).toEqual([100, 1]);
    } finally {
      warning.mockRestore();
    }
  });
  it("sends an agent idle alert with its session name", async () => {
    register();
    await sender.notifyAgentIdle("agent");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)[0]).toMatchObject({
      title: "Agent is idle",
      body: "Fix tests · Tap to view the session.",
      data: { kind: "agent", targetId: "agent" },
    });
  });
  it("does not submit agent notifications after admin access is revoked", async () => {
    register();
    db.update(schema.user)
      .set({ role: "user" })
      .where(eq(schema.user.id, "alice"))
      .run();
    await sender.notifyAgentIdle("agent");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
