import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  getOrStart: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
}));
vi.mock("@/lib/agents/runtime/registry", () => ({
  agentRuntimeRegistry: { getOrStart: mocks.getOrStart },
}));

import { GET } from "./route";

const context = { params: Promise.resolve({ id: "session" }) };

describe("agent session event stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue({
      host: { transport: "local", userId: "owner" },
    });
    mocks.getOrStart.mockResolvedValue({ subscribe: mocks.subscribe });
    mocks.subscribe.mockImplementation(
      (
        listener: (event: Record<string, unknown>) => void,
        afterSequence: number,
      ) => {
        listener({
          sequence: afterSequence + 1,
          type: "snapshot",
          data: { sessionId: "session", status: "idle" },
        });
        return mocks.unsubscribe;
      },
    );
  });

  it("passes Last-Event-ID into replay and emits valid SSE", async () => {
    const response = await GET(
      new Request("http://server.test/events", {
        headers: { "Last-Event-ID": "7" },
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
    expect(text).toContain("id: 8");
    expect(text).toContain("event: runtime");
    expect(mocks.subscribe).toHaveBeenCalledWith(
      expect.any(Function),
      7,
    );
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it("does not start a runtime for a session owned by another user", async () => {
    mocks.getOwnedAgentSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://server.test/events"),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.getOrStart).not.toHaveBeenCalled();
  });
});
