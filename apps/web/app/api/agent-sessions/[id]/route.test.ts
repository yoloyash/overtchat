import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  updateAgentSessionMetadata: vi.fn(),
  getOrStart: vi.fn(),
  create: vi.fn(),
  command: vi.fn(),
  normalizeCommand: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
  updateAgentSessionMetadata: mocks.updateAgentSessionMetadata,
}));
vi.mock("@/lib/agents/runtime/registry", () => ({
  agentRuntimeRegistry: {
    getOrStart: mocks.getOrStart,
    create: mocks.create,
  },
}));

import { GET, POST } from "./route";

const owned = {
  host: { transport: "local", userId: "owner" },
  connection: { id: "connection" },
  workspace: { id: "workspace" },
  agentSession: { id: "session", firstMessage: null },
};

function request(
  method = "GET",
  body?: Record<string, unknown>,
): Request {
  return new Request("http://server.test/api/agent-sessions/session", {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

const context = { params: Promise.resolve({ id: "session" }) };

describe("agent session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue(owned);
    mocks.getOrStart.mockResolvedValue({
      command: mocks.command,
      normalizeCommand: mocks.normalizeCommand,
      snapshot: mocks.snapshot,
    });
    mocks.normalizeCommand.mockImplementation((command) => command);
    mocks.snapshot.mockReturnValue({
      sessionId: "session",
      status: "idle",
      queuedMessages: [],
    });
    mocks.create.mockResolvedValue({
      sessionId: "new-session",
      runtime: { snapshot: vi.fn() },
    });
  });

  it("requires authentication and owner-scoped persistence", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);

    mocks.getSession.mockResolvedValueOnce({
      user: { id: "other", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.getOrStart).not.toHaveBeenCalled();
  });

  it("blocks non-admin users from Agent Connections", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "user" },
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.getOrStart).not.toHaveBeenCalled();
  });

  it("validates and forwards native Pi commands", async () => {
    const response = await POST(
      request("POST", { type: "prompt", message: "Inspect this repo" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith({
      type: "prompt",
      message: "Inspect this repo",
    });
    expect(mocks.updateAgentSessionMetadata).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({ firstMessage: "Inspect this repo" }),
    );

    const invalid = await POST(
      request("POST", { type: "set_model", provider: "", modelId: "" }),
      context,
    );
    expect(invalid.status).toBe(400);
  });

  it("executes built-in slash commands without recording prompt metadata", async () => {
    mocks.normalizeCommand.mockReturnValue({
      type: "set_session_name",
      name: "Release prep",
    });

    const response = await POST(
      request("POST", { type: "prompt", message: "/name Release prep" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith({
      type: "set_session_name",
      name: "Release prep",
    });
    expect(mocks.updateAgentSessionMetadata).toHaveBeenCalledWith("session", {
      name: "Release prep",
    });
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalledWith(
      "session",
      expect.objectContaining({ firstMessage: expect.anything() }),
    );
  });

  it("forwards provider-neutral queue commands", async () => {
    mocks.snapshot.mockReturnValue({
      sessionId: "session",
      status: "running",
      queuedMessages: [
        {
          id: "session:1",
          message: "Then summarize",
          status: "pending",
        },
      ],
    });
    const queued = await POST(
      request("POST", {
        type: "queue",
        message: "Then summarize",
      }),
      context,
    );

    expect(queued.status).toBe(200);
    await expect(queued.json()).resolves.toEqual({
      accepted: true,
      queuedMessages: [
        {
          id: "session:1",
          message: "Then summarize",
          status: "pending",
        },
      ],
    });
    expect(mocks.command).toHaveBeenCalledWith({
      type: "queue",
      message: "Then summarize",
    });
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalled();
  });

  it("forwards steering as an active-turn command", async () => {
    const response = await POST(
      request("POST", {
        type: "steer",
        message: "Focus on the failing test",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.command).toHaveBeenCalledWith({
      type: "steer",
      message: "Focus on the failing test",
    });
    expect(mocks.updateAgentSessionMetadata).toHaveBeenCalledWith(
      "session",
      { providerModifiedAt: expect.any(Date) },
    );
  });

  it("creates a new workspace session for /new without prompting Pi", async () => {
    mocks.normalizeCommand.mockReturnValue({ type: "new_session" });

    const response = await POST(
      request("POST", { type: "prompt", message: "/new" }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      sessionId: "new-session",
    });
    expect(mocks.create).toHaveBeenCalledWith(owned);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalled();
  });
});
