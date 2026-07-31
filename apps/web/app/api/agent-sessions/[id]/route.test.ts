import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  updateAgentSessionMetadata: vi.fn(),
  getOrStart: vi.fn(),
  command: vi.fn(),
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
  agentRuntimeRegistry: { getOrStart: mocks.getOrStart },
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
      snapshot: mocks.snapshot,
    });
    mocks.snapshot.mockReturnValue({ sessionId: "session", status: "idle" });
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

  it("blocks non-admin users from local server execution", async () => {
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
});
