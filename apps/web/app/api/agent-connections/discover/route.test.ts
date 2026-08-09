import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  getOwnedConnector: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/agents/pi/probe", () => ({
  discoverAgentInstallations: mocks.discover,
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  getOwnedHostConnector: mocks.getOwnedConnector,
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
    mocks.getOwnedConnector.mockReturnValue({ id: "connector" });
    mocks.discover.mockResolvedValue([
      {
        provider: "omp",
        executable: "/home/admin/.bun/bin/omp",
        version: "17.2.10",
      },
    ]);
  });

  it("discovers agents through an owned connector and exact SSH alias", async () => {
    const response = await POST(
      request({
        connectorId: "connector",
        transport: "ssh",
        sshAlias: "macbook",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      installations: [
        {
          provider: "omp",
          executable: "/home/admin/.bun/bin/omp",
          version: "17.2.10",
        },
      ],
    });
    expect(mocks.getOwnedConnector).toHaveBeenCalledWith(
      "connector",
      "admin",
    );
    expect(mocks.discover).toHaveBeenCalledWith({
      connectorId: "connector",
      transport: "ssh",
      alias: "macbook",
    });
  });

  it("rejects connectors owned by another user", async () => {
    mocks.getOwnedConnector.mockReturnValue(null);

    const response = await POST(
      request({ connectorId: "other", transport: "local" }),
    );

    expect(response.status).toBe(404);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("keeps discovery restricted to administrators", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    const response = await POST(
      request({ connectorId: "connector", transport: "local" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.getOwnedConnector).not.toHaveBeenCalled();
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
