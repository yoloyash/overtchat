import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getConnector: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  getAvailableHostConnector: mocks.getConnector,
}));
vi.mock("@/lib/agents/connector/providerSnapshots", () => ({
  provisionAgentWorkspace: mocks.reconcile,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://server.test/api/agent-workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("atomic agent workspace route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.getConnector.mockReturnValue({ id: "connector" });
    mocks.reconcile.mockResolvedValue({
      providers: 2,
      created: 2,
      refreshed: 0,
      failures: [],
    });
  });

  it("reconciles a machine and path as one server operation", async () => {
    const response = await POST(
      request({
        target: { connectorId: "connector", transport: "local" },
        path: "/srv/overtchat",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      userId: "admin",
      target: { connectorId: "connector", transport: "local" },
      path: "/srv/overtchat",
    });
  });

  it("does not reconcile an unavailable connector", async () => {
    mocks.getConnector.mockReturnValue(null);
    const response = await POST(
      request({
        target: { connectorId: "other", transport: "local" },
        path: "/srv/overtchat",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects partial success when no provider could be attached", async () => {
    mocks.reconcile.mockResolvedValue({
      providers: 1,
      created: 0,
      refreshed: 0,
      failures: [{ provider: "opencode", message: "Session import failed." }],
    });
    const response = await POST(
      request({
        target: { connectorId: "connector", transport: "local" },
        path: "/srv/overtchat",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Session import failed.",
    });
  });
});
