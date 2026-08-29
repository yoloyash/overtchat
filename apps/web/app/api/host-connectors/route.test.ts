import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  isOnline: vi.fn(),
  daemonRequest: vi.fn(),
  createPairing: vi.fn(),
  deleteConnector: vi.fn(),
  getManagedConnector: vi.fn(),
  getOwnedConnector: vi.fn(),
  listConnectors: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/agents/connector/broker", () => ({
  hostConnectorBroker: {
    isOnline: mocks.isOnline,
    request: mocks.daemonRequest,
  },
}));
vi.mock("@/lib/db/hostConnectors", () => ({
  createHostConnectorPairing: mocks.createPairing,
  deleteHostConnector: mocks.deleteConnector,
  getManagedHostConnector: mocks.getManagedConnector,
  getOwnedHostConnector: mocks.getOwnedConnector,
  listAvailableHostConnectors: mocks.listConnectors,
}));

import { DELETE, GET, POST } from "./route";

function request(method = "GET", query = ""): Request {
  return new Request(`http://server.test/api/host-connectors${query}`, {
    method,
  });
}

describe("Host Connectors route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("HOST_CONNECTOR_URL", "http://127.0.0.1:9000");
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.listConnectors.mockReturnValue([]);
    mocks.getManagedConnector.mockReturnValue(null);
    mocks.isOnline.mockReturnValue(false);
    mocks.createPairing.mockReturnValue({
      pairCode: "ocp_pair.secret",
      expiresAt: new Date(10_000),
    });
    mocks.getOwnedConnector.mockReturnValue({ id: "connector" });
    mocks.deleteConnector.mockReturnValue(true);
    mocks.daemonRequest.mockResolvedValue({ stopped: true });
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
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("returns a one-command local pairing flow", async () => {
    const response = await POST(request("POST"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      pairCode: "ocp_pair.secret",
      expiresAt: 10_000,
      command:
        "curl --proto '=https' --tlsv1.2 -fsSL https://overtchat.com/install/connector/0.9.0 | sh -s -- --server 'http://127.0.0.1:9000' --pair-code 'ocp_pair.secret'",
    });
    expect(mocks.createPairing).toHaveBeenCalledWith("admin");
  });

  it("lists connectors available to the current administrator", async () => {
    mocks.listConnectors.mockReturnValue([
      {
        id: "managed",
        name: "Managed host",
        managed: true,
        version: "0.9.0",
        lastSeenAt: new Date(12_000),
      },
    ]);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.listConnectors).toHaveBeenCalledWith("admin");
    await expect(response.json()).resolves.toMatchObject({
      connectors: [{ id: "managed", managed: true }],
    });
  });

  it("keeps managed connectors under overtchat setup", async () => {
    const managed = {
      id: "managed",
      name: "Managed host",
      managed: true,
      version: "0.4.0",
      lastSeenAt: null,
    };
    mocks.listConnectors.mockReturnValue([managed]);
    mocks.getManagedConnector.mockReturnValue(managed);
    mocks.getOwnedConnector.mockReturnValue(managed);

    const pairResponse = await POST(request("POST"));
    const deleteResponse = await DELETE(
      request("DELETE", "?id=managed"),
    );

    expect(pairResponse.status).toBe(409);
    expect(deleteResponse.status).toBe(409);
    expect(mocks.createPairing).not.toHaveBeenCalled();
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
    expect(mocks.deleteConnector).not.toHaveBeenCalled();
  });

  it("offers an in-place upgrade command for an older connector", async () => {
    mocks.listConnectors.mockReturnValue([
      {
        id: "connector",
        name: "Home server",
        managed: false,
        version: "0.2.0",
        lastSeenAt: new Date(12_000),
      },
    ]);
    mocks.isOnline.mockReturnValue(true);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connectors: [
        {
          id: "connector",
          name: "Home server",
          managed: false,
          version: "0.2.0",
          lastSeenAt: 12_000,
          online: true,
          upgrade: {
            version: "0.9.0",
            command:
              "curl --proto '=https' --tlsv1.2 -fsSL https://overtchat.com/install/connector/0.9.0 | sh -s -- --upgrade",
          },
        },
      ],
    });
  });

  it("does not offer a reinstall or downgrade for a current or newer connector", async () => {
    mocks.listConnectors.mockReturnValue([
      {
        id: "current",
        name: "Current",
        managed: false,
        version: "0.9.0",
        lastSeenAt: null,
      },
      {
        id: "newer",
        name: "Newer",
        managed: false,
        version: "0.9.0",
        lastSeenAt: null,
      },
    ]);

    const response = await GET(request());
    const data = (await response.json()) as {
      connectors: Array<{ upgrade: unknown }>;
    };

    expect(data.connectors.map((connector) => connector.upgrade)).toEqual([
      null,
      null,
    ]);
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
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "stop_all",
    });
    expect(mocks.deleteConnector).toHaveBeenCalledWith(
      "connector",
      "admin",
    );
    expect(mocks.daemonRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteConnector.mock.invocationCallOrder[0],
    );
  });

  it("does not interrupt runtimes for an unknown connector", async () => {
    mocks.getOwnedConnector.mockReturnValue(null);

    const response = await DELETE(
      request("DELETE", "?id=missing"),
    );

    expect(response.status).toBe(404);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
    expect(mocks.deleteConnector).not.toHaveBeenCalled();
  });
});
