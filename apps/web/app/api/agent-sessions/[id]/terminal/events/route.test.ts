import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  isOnline: vi.fn(),
  supports: vi.fn(),
  subscribeTerminal: vi.fn(),
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
  hostConnectorBroker: {
    isOnline: mocks.isOnline,
    supports: mocks.supports,
    subscribeTerminal: mocks.subscribeTerminal,
  },
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

const context = { params: Promise.resolve({ id: "session" }) };

describe("agent terminal event stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue(owned);
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
    mocks.subscribeTerminal.mockImplementation(
      async (
        _connectorId: string,
        _session: unknown,
        _size: unknown,
        listener: (event: unknown) => void,
      ) => {
        listener({ type: "output", revision: 4, data: "live" });
        return {
          snapshot: {
            sessionId: "session",
            revision: 3,
            data: "snapshot",
            cols: 90,
            rows: 28,
            exited: false,
            exitCode: null,
            signal: null,
          },
          unsubscribe: mocks.unsubscribe,
        };
      },
    );
  });

  it("emits the snapshot before buffered terminal output", async () => {
    const response = await GET(
      new Request("http://server.test/events?cols=90&rows=28"),
      context,
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const snapshot = decoder.decode((await reader.read()).value);
    const output = decoder.decode((await reader.read()).value);

    expect(snapshot).toContain("event: terminal-snapshot");
    expect(snapshot).toContain("id: 3");
    expect(output).toContain("event: terminal-output");
    expect(output).toContain("id: 4");
    expect(mocks.subscribeTerminal).toHaveBeenCalledWith(
      "connector",
      expect.objectContaining({ sessionId: "session", cwd: "/workspace" }),
      { cols: 90, rows: 28 },
      expect.any(Function),
      expect.any(Function),
    );
    await reader.cancel();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it("requires an updated connector capability", async () => {
    mocks.supports.mockReturnValue(false);

    const response = await GET(
      new Request("http://server.test/events"),
      context,
    );

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toEqual({
      error: "Update the OvertChat Host Connector to use workspace terminals.",
    });
    expect(mocks.subscribeTerminal).not.toHaveBeenCalled();
  });
});
