import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAgentConnections: vi.fn(),
  createAgentConnection: vi.fn(),
  probePiConnection: vi.fn(),
  encryptAgentCredential: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listAgentConnections: mocks.listAgentConnections,
  createAgentConnection: mocks.createAgentConnection,
}));
vi.mock("@/lib/agents/pi/probe", () => ({
  probePiConnection: mocks.probePiConnection,
}));
vi.mock("@/lib/agents/runtime/credentials", () => ({
  encryptAgentCredential: mocks.encryptAgentCredential,
}));

import { GET, POST } from "./route";

function request(method = "GET", body?: Record<string, unknown>): Request {
  return new Request("http://server.test/api/agent-connections", {
    method,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
}

describe("Agent Connections route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.listAgentConnections.mockResolvedValue([]);
  });

  it("lists connections for administrators", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connections: [] });
    expect(mocks.listAgentConnections).toHaveBeenCalledWith("admin");
  });

  it("does not expose connections to non-admin users", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.listAgentConnections).not.toHaveBeenCalled();
  });

  it("closes the former private-key exception for non-admin users", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await POST(
      request("POST", {
        provider: "pi",
        transport: "ssh",
        name: "Private workstation",
        executable: "pi",
        hostname: "workstation.local",
        port: 22,
        username: "member",
        sshAuth: "private_key",
        privateKey: "PRIVATE KEY",
        hostKey: "workstation.local ssh-ed25519 AAAATEST",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.probePiConnection).not.toHaveBeenCalled();
    expect(mocks.createAgentConnection).not.toHaveBeenCalled();
  });
});
