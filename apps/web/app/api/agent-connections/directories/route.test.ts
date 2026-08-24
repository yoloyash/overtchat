import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  daemonRequest: vi.fn(),
  getOwnedConnector: vi.fn(),
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
  getOwnedHostConnector: mocks.getOwnedConnector,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://server.test/api/agent-connections/directories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Agent target directory route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "admin", role: "admin" },
    });
    mocks.getOwnedConnector.mockReturnValue({ id: "connector" });
    mocks.daemonRequest.mockResolvedValue({
      path: "/srv",
      parent: "/",
      directories: [{ name: "project", path: "/srv/project" }],
    });
  });

  it("browses an SSH target before an agent connection exists", async () => {
    const response = await POST(
      request({
        target: {
          connectorId: "connector",
          transport: "ssh",
          sshAlias: "devbox",
        },
        path: "/srv",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      directory: {
        path: "/srv",
        parent: "/",
        directories: [{ name: "project", path: "/srv/project" }],
      },
    });
    expect(mocks.daemonRequest).toHaveBeenCalledWith("connector", {
      type: "list_directories",
      target: {
        transport: "ssh",
        alias: "devbox",
        shellMode: "interactive",
      },
      path: "/srv",
    });
  });

  it("falls back to a login shell when the interactive shell cannot browse", async () => {
    mocks.daemonRequest
      .mockRejectedValueOnce(new Error("node was not found"))
      .mockResolvedValueOnce({
        path: "/srv",
        parent: "/",
        directories: [],
      });

    const response = await POST(
      request({
        target: { connectorId: "connector", transport: "local" },
        path: "/srv",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.daemonRequest).toHaveBeenNthCalledWith(2, "connector", {
      type: "list_directories",
      target: { transport: "local", shellMode: "login" },
      path: "/srv",
    });
  });

  it("rejects relative paths before contacting the connector", async () => {
    const response = await POST(
      request({
        target: { connectorId: "connector", transport: "local" },
        path: "relative/path",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });

  it("keeps browsing restricted to owned connectors", async () => {
    mocks.getOwnedConnector.mockReturnValue(null);

    const response = await POST(
      request({
        target: { connectorId: "other", transport: "local" },
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.daemonRequest).not.toHaveBeenCalled();
  });
});
