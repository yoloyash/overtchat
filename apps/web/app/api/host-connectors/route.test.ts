import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isOnline: vi.fn(),
  stopUser: vi.fn(),
  createPairing: vi.fn(),
  deleteConnector: vi.fn(),
  getOwnedConnector: vi.fn(),
  listConnectors: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: { isOnline: mocks.isOnline },
}));
vi.mock("@/lib/agents/runtime/registry", () => ({
  agentRuntimeRegistry: { stopUser: mocks.stopUser },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  createHostConnectorPairing: mocks.createPairing,
  deleteHostConnector: mocks.deleteConnector,
  getOwnedHostConnector: mocks.getOwnedConnector,
  listHostConnectors: mocks.listConnectors,
}));

import { DELETE, GET, POST } from "./route";

function request(method = "GET", query = ""): Request {
  return new Request(`http://server.test/api/host-connectors${query}`, {
    method,
  });
}

describe("Host Connectors route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.listConnectors.mockReturnValue([]);
    mocks.isOnline.mockReturnValue(false);
    mocks.createPairing.mockReturnValue({
      pairCode: "ocp_pair.secret",
      expiresAt: new Date(10_000),
    });
    mocks.getOwnedConnector.mockReturnValue({ id: "connector" });
    mocks.deleteConnector.mockReturnValue(true);
  });

  it("keeps connector administration restricted to administrators", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "member", role: "user" },
    });

    expect((await GET(request())).status).toBe(403);
    expect((await POST(request("POST"))).status).toBe(403);
    expect(
      (await DELETE(request("DELETE", "?id=connector"))).status,
    ).toBe(403);
    expect(mocks.listConnectors).not.toHaveBeenCalled();
    expect(mocks.createPairing).not.toHaveBeenCalled();
    expect(mocks.stopUser).not.toHaveBeenCalled();
  });

  it("returns a one-command local pairing flow", async () => {
    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pairCode: "ocp_pair.secret",
      expiresAt: 10_000,
      command:
        "curl --proto '=https' --tlsv1.2 -fsSL https://overtchat.com/install-connector.sh | sh -s -- --pair-code 'ocp_pair.secret'",
    });
    expect(mocks.createPairing).toHaveBeenCalledWith("admin");
  });

  it("stops active runtimes before deleting an owned connector", async () => {
    const response = await DELETE(
      request("DELETE", "?id=connector"),
    );

    expect(response.status).toBe(204);
    expect(mocks.getOwnedConnector).toHaveBeenCalledWith(
      "connector",
      "admin",
    );
    expect(mocks.stopUser).toHaveBeenCalledWith("admin");
    expect(mocks.deleteConnector).toHaveBeenCalledWith(
      "connector",
      "admin",
    );
    expect(mocks.stopUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteConnector.mock.invocationCallOrder[0],
    );
  });

  it("does not interrupt runtimes for an unknown connector", async () => {
    mocks.getOwnedConnector.mockReturnValue(null);

    const response = await DELETE(
      request("DELETE", "?id=missing"),
    );

    expect(response.status).toBe(404);
    expect(mocks.stopUser).not.toHaveBeenCalled();
    expect(mocks.deleteConnector).not.toHaveBeenCalled();
  });
});
