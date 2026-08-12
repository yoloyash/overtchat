import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  updateAgentSessionMetadata: vi.fn(),
  upsertAgentSession: vi.fn(),
  daemonRequest: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
  updateAgentSessionMetadata: mocks.updateAgentSessionMetadata,
  upsertAgentSession: mocks.upsertAgentSession,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { request: mocks.daemonRequest },
}));

import { GET, POST } from "./route";

const owned = {
  host: {
    connectorId: "connector",
    transport: "local",
    sshAlias: null,
    userId: "owner",
  },
  connection: {
    id: "connection",
    provider: "pi",
    shellMode: "interactive",
    executable: "pi",
    detectedVersion: "0.55.0",
  },
  workspace: { id: "workspace", path: "/workspace" },
  agentSession: {
    id: "session",
    providerSessionId: "provider-session",
    providerSessionPath: "/sessions/provider-session.jsonl",
    firstMessage: null,
  },
};

const sessionDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "pi",
  target: { transport: "local", shellMode: "interactive" },
  executable: "pi",
  cwd: "/workspace",
  detectedVersion: "0.55.0",
  sessionId: "session",
  providerSessionId: "provider-session",
  providerSessionPath: "/sessions/provider-session.jsonl",
};

const snapshot = {
  sessionId: "session",
  status: "idle",
  queuedMessages: [],
};

function request(method = "GET", body?: Record<string, unknown>): Request {
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
    mocks.daemonRequest.mockImplementation(
      async (_connectorId: string, command: { type: string }) =>
        command.type === "open_session"
          ? { snapshot }
          : { commandResult: null, snapshot },
    );
    mocks.upsertAgentSession.mockResolvedValue({ id: "new-session" });
  });

  it("requires authentication and owner-scoped persistence", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(401);

    mocks.getSession.mockResolvedValueOnce({
      user: { id: "other", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValueOnce(null);
    expect((await GET(request(), context)).status).toBe(404);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("blocks non-admin users from Agent Connections", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "user" },
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("opens the connector-owned session", async () => {
    const response = await GET(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ snapshot });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "open_session",
      session: sessionDescriptor,
    });
  });

  it("requests and returns an authoritative sync after the browser cursor", async () => {
    const sync = {
      reset: true,
      cursor: { epoch: "new-runtime", sequence: 11 },
      snapshot,
    };
    mocks.daemonRequest.mockResolvedValue({ snapshot, sync });

    const response = await GET(
      new Request(
        "http://server.test/api/agent-sessions/session?after=old-runtime%3A7",
      ),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ snapshot, sync });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "open_session",
      session: sessionDescriptor,
      after: { epoch: "old-runtime", sequence: 7 },
    });
  });

  it("forwards submissions with the browser message identity intact", async () => {
    const response = await POST(
      request("POST", {
        type: "prompt",
        message: "Inspect this repo",
        clientMessageId: "message-1",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "session_command",
      commandId: "message-1",
      clientMessageId: "message-1",
      session: sessionDescriptor,
      command: {
        type: "prompt",
        message: "Inspect this repo",
        clientMessageId: "message-1",
      },
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

  it("forwards image-only prompts and records a useful first message", async () => {
    const image = {
      uploadId: "11111111-1111-4111-8111-111111111111",
      filename: "screen.png",
      mediaType: "image/png",
    };
    const response = await POST(
      request("POST", {
        type: "prompt",
        message: "",
        images: [image],
        clientMessageId: "message-image",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.daemonRequest).toHaveBeenCalledWith(
      "connector",
      expect.objectContaining({
        type: "session_command",
        commandId: "message-image",
        command: expect.objectContaining({ images: [image] }),
      }),
    );
    expect(mocks.updateAgentSessionMetadata).toHaveBeenCalledWith(
      "session",
      expect.objectContaining({ firstMessage: "screen.png" }),
    );
  });

  it("forwards provider-neutral queue commands", async () => {
    const queuedMessages = [
      {
        id: "queue-message",
        message: "Then summarize",
        status: "pending",
      },
    ];
    mocks.daemonRequest.mockResolvedValue({
      commandResult: null,
      snapshot: { ...snapshot, status: "running", queuedMessages },
    });
    const queued = await POST(
      request("POST", {
        type: "queue",
        message: "Then summarize",
        clientMessageId: "queue-message",
      }),
      context,
    );

    expect(queued.status).toBe(200);
    await expect(queued.json()).resolves.toEqual({
      accepted: true,
      queuedMessages,
    });
    expect(mocks.daemonRequest).toHaveBeenCalledWith(
      "connector",
      expect.objectContaining({
        type: "session_command",
        commandId: "queue-message",
        clientMessageId: "queue-message",
        command: {
          type: "queue",
          message: "Then summarize",
          clientMessageId: "queue-message",
        },
      }),
    );
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalled();
  });

  it("returns account usage from the connector read", async () => {
    const usage = { planType: "plus", windows: [] };
    mocks.daemonRequest.mockResolvedValue({ commandResult: usage });

    const response = await POST(
      request("POST", { type: "show_usage" }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      usage,
    });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "session_command",
      commandId: expect.any(String),
      session: sessionDescriptor,
      command: { type: "show_usage" },
    });
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalled();
  });

  it("rejects delivery modes that bypass the connector-owned queue", async () => {
    const steer = await POST(
      request("POST", {
        type: "steer",
        message: "Focus on the failing test",
        clientMessageId: "steer-message",
      }),
      context,
    );
    const interrupt = await POST(
      request("POST", {
        type: "interrupt",
        message: "Replace the current approach",
        clientMessageId: "interrupt-message",
      }),
      context,
    );

    expect(steer.status).toBe(400);
    expect(interrupt.status).toBe(400);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("creates a new connector-owned workspace session", async () => {
    mocks.daemonRequest.mockResolvedValue({
      session: {
        providerSessionId: "new-provider-session",
        providerSessionPath: "/sessions/new-provider-session.jsonl",
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: null,
        modifiedAt: null,
      },
      snapshot: { ...snapshot, sessionId: "new-session" },
    });

    const response = await POST(
      request("POST", { type: "new_session" }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      sessionId: "new-session",
    });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "create_session",
      sessionId: expect.any(String),
      workspace: {
        connectionId: "connection",
        workspaceId: "workspace",
        provider: "pi",
        target: { transport: "local", shellMode: "interactive" },
        executable: "pi",
        cwd: "/workspace",
        detectedVersion: "0.55.0",
      },
    });
    expect(mocks.upsertAgentSession).toHaveBeenCalledWith(
      "workspace",
      expect.objectContaining({ providerSessionId: "new-provider-session" }),
      expect.any(String),
    );
    expect(mocks.updateAgentSessionMetadata).not.toHaveBeenCalled();
  });
});
