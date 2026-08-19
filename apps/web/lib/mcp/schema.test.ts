import { describe, expect, it } from "vitest";
import { McpServerConfigSchema, McpServerInputSchema } from "./schema";

describe("MCP server configuration", () => {
  it("normalizes a Codex-style STDIO configuration", () => {
    expect(
      McpServerInputSchema.parse({
        name: " Example Server ",
        config: {
          transport: "stdio",
          command: " npx ",
          args: ["-y", "@example/mcp-server@1.0.0"],
          env: { EXAMPLE_API_URL: "https://api.example.test" },
          envPassthrough: [" HTTP_PROXY "],
          cwd: " /app ",
        },
      }),
    ).toEqual({
      name: "Example Server",
      availability: "everyone",
      config: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@example/mcp-server@1.0.0"],
        env: { EXAMPLE_API_URL: "https://api.example.test" },
        envPassthrough: ["HTTP_PROXY"],
        cwd: "/app",
      },
    });
  });

  it("accepts Streamable HTTP and rejects other URL schemes", () => {
    expect(
      McpServerConfigSchema.parse({
        transport: "http",
        url: "https://mcp.example.test/mcp",
        headers: { "X-Workspace": "overtchat" },
        envHeaders: { "X-Token": "MCP_HEADER_TOKEN" },
        bearerTokenEnvVar: "MCP_TOKEN",
      }),
    ).toMatchObject({ transport: "http" });

    expect(() =>
      McpServerConfigSchema.parse({
        transport: "http",
        url: "file:///tmp/mcp.sock",
      }),
    ).toThrow(/http or https/);
  });

  it("accepts only the supported admin availability policies", () => {
    const base = {
      name: "Reference",
      config: {
        transport: "stdio" as const,
        command: "reference-mcp",
      },
    };

    expect(
      McpServerInputSchema.parse({ ...base, availability: "admins" }),
    ).toMatchObject({ availability: "admins" });
    expect(() =>
      McpServerInputSchema.parse({ ...base, availability: "private" }),
    ).toThrow();
  });

  it("rejects invalid environment variable names", () => {
    expect(() =>
      McpServerConfigSchema.parse({
        transport: "stdio",
        command: "node",
        env: { "NOT VALID": "value" },
      }),
    ).toThrow(/letters, numbers, and underscores/);

    expect(() =>
      McpServerConfigSchema.parse({
        transport: "http",
        url: "https://mcp.example.test/mcp",
        envHeaders: { "X-Token": "NOT VALID" },
      }),
    ).toThrow(/letters, numbers, and underscores/);
  });
});
