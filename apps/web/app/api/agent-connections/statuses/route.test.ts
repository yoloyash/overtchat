import type { AgentRuntimeStatus } from "@overtchat/agent-bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAgentConnections: vi.fn(),
  subscribeSessionStatuses: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listAgentConnections: mocks.listAgentConnections,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    subscribeSessionStatuses: mocks.subscribeSessionStatuses,
  },
}));

import { GET } from "./route";

describe("agent connection status stream", () => {
  let listener:
    | ((sessionId: string, status: AgentRuntimeStatus) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.listAgentConnections.mockResolvedValue([
      {
        workspaces: [
          {
            sessions: [{ id: "session" }, { id: "other-session" }],
          },
        ],
      },
    ]);
    mocks.subscribeSessionStatuses.mockImplementation(
      (
        _sessionIds: string[],
        subscriber: (sessionId: string, status: AgentRuntimeStatus) => void,
      ) => {
        listener = subscriber;
        subscriber("session", "idle");
        return mocks.unsubscribe;
      },
    );
  });

  it("streams authorized session status transitions and cleans up", async () => {
    const response = await GET(
      new Request("http://server.test/api/agent-connections/statuses"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(
      "text/event-stream",
    );
    expect(mocks.subscribeSessionStatuses).toHaveBeenCalledWith(
      ["session", "other-session"],
      expect.any(Function),
    );
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain("event: status");
    expect(initial).toContain(
      JSON.stringify({ sessionId: "session", runtimeStatus: "idle" }),
    );

    listener?.("session", "running");
    const running = new TextDecoder().decode((await reader.read()).value);
    expect(running).toContain(
      JSON.stringify({ sessionId: "session", runtimeStatus: "running" }),
    );
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not expose statuses to non-admin users", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await GET(
      new Request("http://server.test/api/agent-connections/statuses"),
    );

    expect(response.status).toBe(403);
    expect(mocks.listAgentConnections).not.toHaveBeenCalled();
    expect(mocks.subscribeSessionStatuses).not.toHaveBeenCalled();
  });
});
