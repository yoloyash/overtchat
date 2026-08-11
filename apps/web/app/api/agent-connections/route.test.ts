import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAgentConnections: vi.fn(),
  createAgentConnection: vi.fn(),
  daemonRequest: vi.fn(),
  getOwnedHostConnector: vi.fn(),
  withAgentRuntimeStatuses: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/agentConnections", () => ({
  listAgentConnections: mocks.listAgentConnections,
  createAgentConnection: mocks.createAgentConnection,
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { request: mocks.daemonRequest },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  getOwnedHostConnector: mocks.getOwnedHostConnector,
}));
vi.mock("@/lib/agents/connector/status", () => ({
  withAgentRuntimeStatuses: mocks.withAgentRuntimeStatuses,
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
    mocks.getOwnedHostConnector.mockReturnValue({ id: "connector" });
    mocks.withAgentRuntimeStatuses.mockImplementation(
      (connections) => connections,
    );
  });

  it("lists connections for administrators", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ connections: [] });
    expect(mocks.listAgentConnections).toHaveBeenCalledWith("admin");
    expect(mocks.withAgentRuntimeStatuses).toHaveBeenCalledWith([]);
  });

  it("does not expose connections to non-admin users", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.listAgentConnections).not.toHaveBeenCalled();
  });

  it("does not allow non-admin users to create connector-backed connections", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await POST(
      request("POST", {
        provider: "pi",
        transport: "ssh",
        connectorId: "11111111-1111-4111-8111-111111111111",
        name: "Workstation",
        executable: "pi",
        sshAlias: "workstation",
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
    expect(mocks.createAgentConnection).not.toHaveBeenCalled();
  });

  it("persists the shell mode selected during connection probing", async () => {
    mocks.daemonRequest.mockResolvedValue({
      status: "ready",
      version: "17.2.11",
      models: [],
      shellMode: "interactive",
    });
    mocks.createAgentConnection.mockReturnValue({
      host: { id: "host" },
      connection: { id: "connection" },
    });
    const connection = {
      id: "connection",
      provider: "omp",
      executable: "/Users/yash/.bun/bin/omp",
      detectedVersion: "17.2.11",
      lastValidatedAt: Date.now(),
      host: {
        id: "host",
        connectorId: "connector",
        name: "macbook",
        transport: "ssh",
        sshAlias: "macbook",
      },
      workspaces: [],
    };
    mocks.listAgentConnections.mockResolvedValue([connection]);

    const response = await POST(
      request("POST", {
        provider: "omp",
        transport: "ssh",
        connectorId: "connector",
        name: "macbook",
        executable: "/Users/yash/.bun/bin/omp",
        sshAlias: "macbook",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createAgentConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: {
          provider: "omp",
          executable: "/Users/yash/.bun/bin/omp",
          detectedVersion: "17.2.11",
          shellMode: "interactive",
        },
      }),
    );
  });
});
