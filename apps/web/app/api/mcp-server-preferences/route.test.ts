import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listAvailableMcpServers: vi.fn(),
  setMcpServerPreference: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/mcpServers", () => ({
  listAvailableMcpServers: mocks.listAvailableMcpServers,
  setMcpServerPreference: mocks.setMcpServerPreference,
}));

import { PATCH } from "./[id]/route";
import { GET } from "./route";

function request(method: string, body?: unknown) {
  return new Request("http://server.test/api/mcp-server-preferences", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

describe("MCP server preference routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "user", role: "user" },
    });
  });

  it("requires authentication", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect((await GET(request("GET"))).status).toBe(401);
    expect(
      (
        await PATCH(request("PATCH", { enabled: false }), {
          params: Promise.resolve({ id: "server" }),
        })
      ).status,
    ).toBe(401);
  });

  it("returns only the user-safe available server projection", async () => {
    mocks.listAvailableMcpServers.mockResolvedValue([
      { id: "server", name: "Reference", enabled: true },
    ]);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mcpServers: [{ id: "server", name: "Reference", enabled: true }],
    });
    expect(mocks.listAvailableMcpServers).toHaveBeenCalledWith("user", "user");
  });

  it("updates an authorized server preference", async () => {
    mocks.setMcpServerPreference.mockResolvedValue({
      id: "server",
      name: "Reference",
      enabled: false,
    });

    const response = await PATCH(request("PATCH", { enabled: false }), {
      params: Promise.resolve({ id: "server" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.setMcpServerPreference).toHaveBeenCalledWith(
      "user",
      "user",
      "server",
      false,
    );
  });

  it("does not reveal unavailable server IDs", async () => {
    mocks.setMcpServerPreference.mockResolvedValue(null);

    const response = await PATCH(request("PATCH", { enabled: true }), {
      params: Promise.resolve({ id: "admin-only" }),
    });

    expect(response.status).toBe(404);
  });
});
