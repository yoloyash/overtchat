import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectMcpServer: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mcp/runtime", () => ({
  connectMcpServer: mocks.connectMcpServer,
}));

import type { McpServerRow } from "@/lib/db/mcpServers";
import { checkMcpServerHealth } from "./health";

const server: McpServerRow = {
  id: "reference",
  name: "Reference",
  availability: "disabled",
  config: {
    transport: "http",
    url: "https://mcp.example.test",
    headers: {},
  },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("MCP server health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("discovers tools and closes the diagnostic connection", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    mocks.connectMcpServer.mockResolvedValue({
      rawTools: { echo: {}, lookup: {} },
      close,
    });

    await expect(checkMcpServerHealth(server)).resolves.toMatchObject({
      ok: true,
      toolCount: 2,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns connection failures as health results", async () => {
    mocks.connectMcpServer.mockRejectedValue(new Error("connection refused"));

    await expect(checkMcpServerHealth(server)).resolves.toMatchObject({
      ok: false,
      error: "connection refused",
    });
  });
});
