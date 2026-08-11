import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  subscribeSession: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { subscribeSession: mocks.subscribeSession },
}));

import { GET } from "./route";

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

const context = { params: Promise.resolve({ id: "session" }) };

describe("agent session event stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue(owned);
    mocks.subscribeSession.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        after: { epoch: string; sequence: number } | undefined,
        listener: (event: Record<string, unknown>) => void,
      ) => {
        listener({
          epoch: "runtime",
          sequence: (after?.sequence ?? 0) + 1,
          type: "snapshot",
          data: { sessionId: "session", status: "idle" },
        });
        return mocks.unsubscribe;
      },
    );
  });

  it("passes the runtime cursor into replay and emits valid SSE", async () => {
    const response = await GET(
      new Request("http://server.test/events", {
        headers: { "Last-Event-ID": "runtime:7" },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("id: runtime:8");
    expect(text).toContain("event: runtime");
    expect(mocks.subscribeSession).toHaveBeenCalledWith(
      "connector",
      sessionDescriptor,
      { epoch: "runtime", sequence: 7 },
      expect.any(Function),
      expect.any(Function),
    );
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it("does not subscribe to a session owned by another user", async () => {
    mocks.getOwnedAgentSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/events"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.subscribeSession).not.toHaveBeenCalled();
  });
});
