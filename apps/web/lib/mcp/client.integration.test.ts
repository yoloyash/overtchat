import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createConfiguredMcpClient } from "./client";

const MODERN_MCP_FIXTURE = String.raw`
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });

function result(id, value) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", ...value },
  }) + "\n");
}

function error(id, message) {
  process.stdout.write(JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message },
  }) + "\n");
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "server/discover") {
    result(message.id, {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "overtchat-test",
          version: "1.0.0",
        },
      },
    });
    return;
  }
  if (message.method === "initialize") {
    error(message.id, "Legacy initialization is not supported by this fixture");
    return;
  }
  if (message.method === "tools/list") {
    result(message.id, {
      tools: [{
        name: "read_cache",
        description: "Return the npm cache seen by the child process",
        inputSchema: { type: "object", properties: {} },
      }],
    });
    return;
  }
  if (message.method === "tools/call") {
    result(message.id, {
      content: [{
        type: "text",
        text: process.env.NPM_CONFIG_CACHE || "",
      }],
    });
    return;
  }
  if (message.id !== undefined) {
    error(message.id, "Unsupported method: " + message.method);
  }
});
`;

describe("MCP STDIO integration", () => {
  it("preserves modern discovery and passes the runtime npm cache to the child", async () => {
    const previousCache = process.env.NPM_CONFIG_CACHE;
    process.env.NPM_CONFIG_CACHE = "/app/npm-cache";
    let client: Awaited<ReturnType<typeof createConfiguredMcpClient>> | null =
      null;

    try {
      client = await createConfiguredMcpClient({
        transport: "stdio",
        command: process.execPath,
        args: ["-e", MODERN_MCP_FIXTURE],
        env: {},
        envPassthrough: [],
      });

      expect(client.initializeResult.protocolVersion).toBe("2026-07-28");
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [{ name: "read_cache" }],
      });
      await expect(
        client.callTool({ name: "read_cache" }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: "/app/npm-cache" }],
      });
    } finally {
      await client?.close();
      if (previousCache === undefined) {
        delete process.env.NPM_CONFIG_CACHE;
      } else {
        process.env.NPM_CONFIG_CACHE = previousCache;
      }
    }
  });
});
