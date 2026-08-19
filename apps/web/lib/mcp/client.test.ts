import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  createMCPClient: vi.fn(),
  stdioConfigs: [] as Array<Record<string, unknown>>,
  stdioTransports: [] as Array<{
    onclose?: () => void;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: mocks.createMCPClient,
}));
vi.mock("@ai-sdk/mcp/mcp-stdio", () => ({
  Experimental_StdioMCPTransport: class MockStdioTransport {
    readonly supportsProtocolVersionDiscovery = true;
    readonly supportsMcpToolParameterHeaders = true;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: unknown) => void;
    send = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);

    constructor(config: Record<string, unknown>) {
      mocks.stdioConfigs.push(config);
      mocks.stdioTransports.push(this);
    }

    start() {
      return Promise.resolve();
    }
  },
}));

import {
  createConfiguredMcpClient,
  listAllMcpTools,
} from "./client";

const close = vi.fn();

describe("MCP clients", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.stdioConfigs.length = 0;
    mocks.stdioTransports.length = 0;
    close.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.OVERTCHAT_MCP_TEST_PARENT;
    delete process.env.OVERTCHAT_MCP_TEST_TOKEN;
    delete process.env.OVERTCHAT_MCP_HEADER_TOKEN;
    delete process.env.NPM_CONFIG_CACHE;
  });

  it("builds STDIO transports with explicit and passthrough environment", async () => {
    process.env.OVERTCHAT_MCP_TEST_PARENT = "inherited";
    process.env.NPM_CONFIG_CACHE = "/app/npm-cache";
    const client = { close };
    mocks.createMCPClient.mockResolvedValue(client);

    await expect(
      createConfiguredMcpClient({
        transport: "stdio",
        command: "npx",
        args: ["-y", "example-mcp"],
        env: { DIRECT: "configured" },
        envPassthrough: ["OVERTCHAT_MCP_TEST_PARENT", "MISSING_VALUE"],
        cwd: "/app",
      }),
    ).resolves.toBe(client);

    expect(mocks.stdioConfigs).toEqual([
      {
        command: "npx",
        args: ["-y", "example-mcp"],
        env: {
          NPM_CONFIG_CACHE: "/app/npm-cache",
          OVERTCHAT_MCP_TEST_PARENT: "inherited",
          DIRECT: "configured",
        },
        cwd: "/app",
      },
    ]);
  });

  it("allows explicit MCP environment to override the runtime npm cache", async () => {
    process.env.NPM_CONFIG_CACHE = "/app/npm-cache";
    mocks.createMCPClient.mockResolvedValue({ close });

    await createConfiguredMcpClient({
      transport: "stdio",
      command: "npx",
      args: [],
      env: { NPM_CONFIG_CACHE: "/custom/cache" },
      envPassthrough: [],
    });

    expect(mocks.stdioConfigs[0]?.env).toEqual({
      NPM_CONFIG_CACHE: "/custom/cache",
    });
  });

  it("forwards STDIO transport capabilities and request options", async () => {
    const client = { close };
    const signal = new AbortController().signal;
    const message = { jsonrpc: "2.0", method: "ping" };
    const sendOptions = { signal, relatedRequestId: "request-1" };
    const closeOptions = { signal };
    mocks.createMCPClient.mockImplementation(async ({ transport }) => {
      expect(transport.supportsProtocolVersionDiscovery).toBe(true);
      expect(transport.supportsMcpToolParameterHeaders).toBe(true);
      await transport.send(message, sendOptions);
      await transport.close(closeOptions);
      return client;
    });

    await createConfiguredMcpClient({
      transport: "stdio",
      command: "node",
      args: [],
      env: {},
      envPassthrough: [],
    });

    expect(mocks.stdioTransports[0]?.send).toHaveBeenCalledWith(
      message,
      sendOptions,
    );
    expect(mocks.stdioTransports[0]?.close).toHaveBeenCalledWith(closeOptions);
  });

  it("resolves bearer tokens from the OvertChat environment", async () => {
    process.env.OVERTCHAT_MCP_TEST_TOKEN = "secret";
    mocks.createMCPClient.mockResolvedValue({ close });

    await createConfiguredMcpClient({
      transport: "http",
      url: "https://mcp.example.test/mcp",
      headers: { "X-Test": "value" },
      bearerTokenEnvVar: "OVERTCHAT_MCP_TEST_TOKEN",
    });

    expect(mocks.createMCPClient).toHaveBeenCalledWith({
      clientName: "overtchat",
      initializationOptions: { timeout: 30_000 },
      transport: {
        type: "http",
        url: "https://mcp.example.test/mcp",
        headers: {
          "X-Test": "value",
          Authorization: "Bearer secret",
        },
      },
    });
  });

  it("resolves HTTP header values from environment variables", async () => {
    process.env.OVERTCHAT_MCP_HEADER_TOKEN = "environment-secret";
    mocks.createMCPClient.mockResolvedValue({ close });

    await createConfiguredMcpClient({
      transport: "http",
      url: "https://mcp.example.test/mcp",
      headers: { "X-Literal": "literal" },
      envHeaders: { "X-Secret": "OVERTCHAT_MCP_HEADER_TOKEN" },
    });

    expect(mocks.createMCPClient).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          headers: {
            "X-Literal": "literal",
            "X-Secret": "environment-secret",
          },
        }),
      }),
    );
  });

  it("expands a home-relative working directory like Codex", async () => {
    mocks.createMCPClient.mockResolvedValue({ close });

    await createConfiguredMcpClient({
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
      envPassthrough: [],
      cwd: "~/code",
    });

    expect(mocks.stdioConfigs[0]?.cwd).toBe(path.join(os.homedir(), "code"));
  });

  it("reports an unexpected STDIO disconnect to its lifecycle owner", async () => {
    const onDisconnect = vi.fn();
    const client = { close };
    mocks.createMCPClient.mockImplementation(async ({ transport }) => {
      transport.onclose = vi.fn();
      await transport.start();
      return client;
    });

    await createConfiguredMcpClient(
      {
        transport: "stdio",
        command: "npx",
        args: ["-y", "example-mcp"],
        env: {},
        envPassthrough: [],
      },
      { onDisconnect },
    );
    mocks.stdioTransports[0]?.onclose?.();

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("collects paginated tool catalogs", async () => {
    const listTools = vi
      .fn()
      .mockResolvedValueOnce({
        tools: [{ name: "echo", description: "Echo input" }],
        nextCursor: "next",
      })
      .mockResolvedValueOnce({
        tools: [{ name: "lookup", description: "Look up input" }],
      });
    const client = {
      listTools,
      close,
    };

    await expect(
      listAllMcpTools(
        client as never,
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      tools: [
        { name: "echo", description: "Echo input" },
        { name: "lookup", description: "Look up input" },
      ],
    });
    expect(listTools).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ params: { cursor: "next" } }),
    );
  });
});
