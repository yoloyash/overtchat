import { describe, expect, it } from "vitest";
import {
  isMcpToolName,
  mcpToolName,
  mcpToolNames,
  parseMcpToolName,
} from "@overtchat/shared";

describe("MCP tool names", () => {
  it("creates stable provider-safe names with readable labels", () => {
    const name = mcpToolName(
      { id: "server-1", name: "GitHub Enterprise" },
      "search-code",
    );
    expect(name).toBe("mcp__GitHub_Enterprise__search-code");
    expect(name.length).toBeLessThanOrEqual(64);
    expect(parseMcpToolName(name)).toEqual({
      serverName: "GitHub Enterprise",
      toolName: "search-code",
    });
    expect(isMcpToolName(name)).toBe(true);
  });

  it("keeps normalized tool-name collisions distinct", () => {
    const server = { id: "server-1", name: "Server" };
    const [first, second] = mcpToolNames([
      { server, toolName: "foo bar" },
      { server, toolName: "foo_bar" },
    ]);
    expect(first).not.toBe(second);
  });

  it("hashes only colliding namespaces and keeps names within API limits", () => {
    const names = mcpToolNames([
      {
        server: { id: "first", name: "Same Server" },
        toolName: "a".repeat(100),
      },
      {
        server: { id: "second", name: "Same_Server" },
        toolName: "lookup",
      },
    ]);

    expect(names[0]).not.toBe(names[1]);
    expect(names.every((name) => name.length <= 64)).toBe(true);
    expect(names.every((name) => /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(name))).toBe(
      true,
    );
  });
});
