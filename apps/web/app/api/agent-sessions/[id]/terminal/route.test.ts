import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOwnedAgentSession: vi.fn(),
  isOnline: vi.fn(),
  supports: vi.fn(),
  sendTerminalInput: vi.fn(),
  resizeTerminal: vi.fn(),
  restartTerminal: vi.fn(),
  killTerminal: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  getOwnedAgentSession: mocks.getOwnedAgentSession,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: mocks,
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
  },
};

const context = { params: Promise.resolve({ id: "session" }) };

function request(body: unknown) {
  return new Request("http://server.test/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("agent terminal controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "admin" },
    });
    mocks.getOwnedAgentSession.mockResolvedValue(owned);
    mocks.isOnline.mockReturnValue(true);
    mocks.supports.mockReturnValue(true);
    mocks.restartTerminal.mockResolvedValue({
      sessionId: "session",
      revision: 0,
      data: "",
      cols: 80,
      rows: 24,
      exited: false,
      exitCode: null,
      signal: null,
    });
  });

  it("relays input and resize only to the owned session", async () => {
    const input = await POST(
      request({ type: "input", data: "pwd\r" }),
      context,
    );
    const resize = await POST(
      request({
        type: "resize",
        controlId: "control-one",
        size: { cols: 100, rows: 32 },
      }),
      context,
    );

    expect(input.status).toBe(204);
    expect(resize.status).toBe(204);
    expect(mocks.sendTerminalInput).toHaveBeenCalledWith(
      "connector",
      "session",
      "pwd\r",
    );
    expect(mocks.resizeTerminal).toHaveBeenCalledWith(
      "connector",
      "session",
      "control-one",
      { cols: 100, rows: 32 },
    );
  });

  it("restarts the workspace terminal with the session descriptor", async () => {
    const response = await POST(
      request({ type: "restart", size: { cols: 80, rows: 24 } }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.restartTerminal).toHaveBeenCalledWith(
      "connector",
      expect.objectContaining({ sessionId: "session", cwd: "/workspace" }),
      { cols: 80, rows: 24 },
    );
  });

  it("rejects invalid and oversized input", async () => {
    const response = await POST(
      request({ type: "input", data: "x".repeat(65 * 1_024) }),
      context,
    );

    expect(response.status).toBe(400);
    expect(mocks.sendTerminalInput).not.toHaveBeenCalled();
  });

  it("reports when the installed connector needs an upgrade", async () => {
    mocks.supports.mockReturnValue(false);

    const response = await GET(
      new Request("http://server.test/terminal"),
      context,
    );

    expect(response.status).toBe(426);
    await expect(response.json()).resolves.toEqual({
      error: "Update the OvertChat Host Connector to use workspace terminals.",
    });
  });

  it("does not expose terminal controls for an unowned session", async () => {
    mocks.getOwnedAgentSession.mockResolvedValue(null);

    const response = await POST(
      request({ type: "input", data: "pwd\r" }),
      context,
    );

    expect(response.status).toBe(404);
    expect(mocks.sendTerminalInput).not.toHaveBeenCalled();
    expect(mocks.resizeTerminal).not.toHaveBeenCalled();
    expect(mocks.restartTerminal).not.toHaveBeenCalled();
    expect(mocks.killTerminal).not.toHaveBeenCalled();
  });

  it("keeps terminal controls admin-only", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "owner", role: "user" },
    });

    const response = await POST(
      request({ type: "input", data: "pwd\r" }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.getOwnedAgentSession).not.toHaveBeenCalled();
    expect(mocks.sendTerminalInput).not.toHaveBeenCalled();
  });
});
