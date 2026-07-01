import { describe, expect, it } from "vitest";
import { namespacedMcpToolName } from "./mcpNames";

describe("namespacedMcpToolName", () => {
  it("creates stable AI SDK-safe names with server and tool context", () => {
    const first = namespacedMcpToolName("Docs Server", "Search Docs");
    const second = namespacedMcpToolName("Docs Server", "Search Docs");

    expect(first).toBe(second);
    expect(first).toMatch(/^mcp_docs_server_search_docs_[a-f0-9]{8}$/);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it("trims long names without dropping the hash suffix", () => {
    const name = namespacedMcpToolName(
      "really-long-server-name-that-keeps-going",
      "tool-name-that-is-also-way-too-long-to-fit-without-trimming",
    );

    expect(name).toMatch(/_[a-f0-9]{8}$/);
    expect(name.length).toBeLessThanOrEqual(64);
  });

  it("deduplicates collisions in the used-name set", () => {
    const used = new Set<string>();
    const first = namespacedMcpToolName("docs", "search", used);
    const second = namespacedMcpToolName("docs", "search", used);

    expect(second).not.toBe(first);
    expect(second).toMatch(/_2$/);
    expect(used).toEqual(new Set([first, second]));
  });
});
