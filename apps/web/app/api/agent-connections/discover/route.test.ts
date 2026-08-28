import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  daemonRequest: vi.fn(),
  getAvailableConnector: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { request: mocks.daemonRequest },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  getAvailableHostConnector: mocks.getAvailableConnector,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request(
    "http://server.test/api/agent-connections/discover",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("Agent Connection discovery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.getAvailableConnector.mockReturnValue({ id: "connector" });
    mocks.daemonRequest.mockResolvedValue({
      target: {
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "macbook",
      },
      providers: [
        { provider: "pi", status: "unavailable" },
        {
          provider: "omp",
          status: "ready",
          executable: "/home/admin/.bun/bin/omp",
          version: "17.2.10",
          shellMode: "interactive",
        },
        { provider: "codex", status: "unavailable" },
        { provider: "opencode", status: "unavailable" },
        { provider: "claude", status: "unavailable" },
      ],
      refreshedAt: 123,
    });
  });

  it("discovers agents through an available connector and exact SSH alias", async () => {
    const response = await POST(
      request({
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "macbook",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      snapshot: {
        target: {
          connectorId: "connector",
          transport: "ssh",
          sshAlias: "macbook",
        },
        providers: [
          { provider: "pi", status: "unavailable" },
          {
            provider: "omp",
            status: "ready",
            executable: "/home/admin/.bun/bin/omp",
            version: "17.2.10",
            shellMode: "interactive",
          },
          { provider: "codex", status: "unavailable" },
          { provider: "opencode", status: "unavailable" },
          { provider: "claude", status: "unavailable" },
        ],
        refreshedAt: 123,
      },
      installations: [
        {
          provider: "omp",
          executable: "/home/admin/.bun/bin/omp",
          version: "17.2.10",
          shellMode: "interactive",
        },
      ],
    });
    expect(mocks.getAvailableConnector).toHaveBeenCalledWith(
      "connector",
      "admin",
    );
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "provider_snapshot",
      target: {
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "macbook",
      },
      refresh: true,
    });
  });

  it("rejects connectors unavailable to the current administrator", async () => {
    mocks.getAvailableConnector.mockReturnValue(null);

    const response = await POST(
      request({ connectorId: "other", transport: "local" }),
    );

    expect(response.status).toBe(404);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("keeps discovery restricted to administrators", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await POST(
      request({ connectorId: "connector", transport: "local" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getAvailableConnector).not.toHaveBeenCalled();
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
