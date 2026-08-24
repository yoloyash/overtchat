import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  getMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  checkMcpServerHealth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/mcpServers", () => ({
  listMcpServers: mocks.listMcpServers,
  createMcpServer: mocks.createMcpServer,
  getMcpServer: mocks.getMcpServer,
  updateMcpServer: mocks.updateMcpServer,
  deleteMcpServer: mocks.deleteMcpServer,
  toMcpServer: (row: unknown) => row,
}));
vi.mock("@/lib/mcp/health", () => ({
  checkMcpServerHealth: mocks.checkMcpServerHealth,
}));

import { DELETE, PATCH } from "./[id]/route";
import { POST as HEALTH } from "./[id]/health/route";
import { GET, POST } from "./route";

const input = {
  name: "Reference MCP",
  availability: "everyone" as const,
  config: {
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", "reference-mcp"],
    env: {},
    envPassthrough: [],
  },
};

function request(method: string, body?: unknown) {
  return new Request("http://server.test/api/mcp-servers", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

describe("MCP server routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "admin", role: "admin" } });
  });

  it("keeps configuration admin-only", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user", role: "user" } });
    expect((await GET(request("GET"))).status).toBe(403);
    expect((await POST(request("POST", input))).status).toBe(403);
    expect(
      (
        await HEALTH(request("POST"), {
          params: Promise.resolve({ id: "server" }),
        })
      ).status,
    ).toBe(403);
    expect(mocks.listMcpServers).not.toHaveBeenCalled();
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("lists configured servers", async () => {
    mocks.listMcpServers.mockResolvedValue([{ id: "server", ...input }]);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mcpServers: [{ id: "server", ...input }],
    });
  });

  it("validates and creates a server", async () => {
    mocks.createMcpServer.mockImplementation(async (value) => ({
      id: "server",
      ...value,
    }));
    const response = await POST(request("POST", input));
    expect(response.status).toBe(201);
    expect(mocks.createMcpServer).toHaveBeenCalledWith(input);
  });

  it("rejects malformed configurations", async () => {
    const response = await POST(
      request("POST", {
        name: "Broken",
        config: { transport: "stdio", command: "" },
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createMcpServer).not.toHaveBeenCalled();
  });

  it("updates and deletes existing servers", async () => {
    mocks.getMcpServer.mockResolvedValue({ id: "server", ...input });
    mocks.updateMcpServer.mockResolvedValue({ id: "server", ...input });

    const context = { params: Promise.resolve({ id: "server" }) };
    expect((await PATCH(request("PATCH", input), context)).status).toBe(200);
    expect(mocks.updateMcpServer).toHaveBeenCalledWith("server", input);
    expect((await DELETE(request("DELETE"), context)).status).toBe(204);
    expect(mocks.deleteMcpServer).toHaveBeenCalledWith("server");
  });

  it("checks a server with a temporary MCP connection", async () => {
    const server = { id: "server", ...input };
    mocks.getMcpServer.mockResolvedValue(server);
    mocks.checkMcpServerHealth.mockResolvedValue({
      ok: true,
      elapsedMs: 125,
      toolCount: 3,
    });

    const response = await HEALTH(request("POST"), {
      params: Promise.resolve({ id: "server" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      elapsedMs: 125,
      toolCount: 3,
    });
    expect(mocks.checkMcpServerHealth).toHaveBeenCalledWith(server);
  });
});
