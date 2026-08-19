import "server-only";
import {
  createMCPClient,
  type ListToolsResult,
  type MCPClient,
  type MCPTransport,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import os from "node:os";
import path from "node:path";
import type {
  McpServerConfig,
  StdioMcpConfig,
  StreamableHttpMcpConfig,
} from "@/lib/mcp/schema";

export const MCP_SETUP_TIMEOUT_MS = 30_000;
export const MCP_TOOL_TIMEOUT_MS = 300_000;
const MAX_MCP_CATALOG_ITEMS = 2_048;

type ClientLifecycle = {
  onDisconnect?(): void;
  initializationSignal?: AbortSignal;
};

function initializationOptions(lifecycle: ClientLifecycle) {
  return {
    timeout: MCP_SETUP_TIMEOUT_MS,
    ...(lifecycle.initializationSignal
      ? { signal: lifecycle.initializationSignal }
      : {}),
  };
}

class LifecycleMcpTransport implements MCPTransport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: MCPTransport["onmessage"];

  constructor(
    private readonly transport: MCPTransport,
    private readonly lifecycle: ClientLifecycle,
  ) {}

  get supportsProtocolVersionDiscovery() {
    return this.transport.supportsProtocolVersionDiscovery;
  }

  get supportsMcpToolParameterHeaders() {
    return this.transport.supportsMcpToolParameterHeaders;
  }

  get protocolVersion() {
    return this.transport.protocolVersion;
  }

  set protocolVersion(value: string | undefined) {
    this.transport.protocolVersion = value;
  }

  setProtocolVersion(version: string) {
    if (this.transport.setProtocolVersion) {
      this.transport.setProtocolVersion(version);
    } else {
      this.transport.protocolVersion = version;
    }
  }

  async start() {
    this.transport.onclose = () => {
      this.lifecycle.onDisconnect?.();
      this.onclose?.();
    };
    this.transport.onerror = (error) => this.onerror?.(error);
    this.transport.onmessage = (message) => this.onmessage?.(message);
    await this.transport.start();
  }

  send(
    message: Parameters<MCPTransport["send"]>[0],
    options?: Parameters<MCPTransport["send"]>[1],
  ) {
    return this.transport.send(message, options);
  }

  close(options?: Parameters<MCPTransport["close"]>[0]) {
    return this.transport.close(options);
  }
}

function stdioEnvironment(config: StdioMcpConfig): Record<string, string> {
  const runtime = Object.fromEntries(
    ["NPM_CONFIG_CACHE"].flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const inherited = Object.fromEntries(
    config.envPassthrough.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return { ...runtime, ...inherited, ...config.env };
}

function httpHeaders(config: StreamableHttpMcpConfig): Record<string, string> {
  const headers = { ...config.headers };
  for (const [header, environmentName] of Object.entries(
    config.envHeaders ?? {},
  )) {
    const value = process.env[environmentName];
    if (value === undefined) {
      throw new Error(`Environment variable ${environmentName} is not set`);
    }
    headers[header] = value;
  }
  if (config.bearerTokenEnvVar) {
    const token = process.env[config.bearerTokenEnvVar];
    if (!token) {
      throw new Error(
        `Environment variable ${config.bearerTokenEnvVar} is not set`,
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function workingDirectory(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  if (cwd === "~") return os.homedir();
  if (cwd.startsWith("~/") || cwd.startsWith("~\\")) {
    return path.join(os.homedir(), cwd.slice(2));
  }
  return cwd;
}

export async function createConfiguredMcpClient(
  config: McpServerConfig,
  lifecycle: ClientLifecycle = {},
): Promise<MCPClient> {
  if (config.transport === "stdio") {
    const transport = new LifecycleMcpTransport(
      new Experimental_StdioMCPTransport({
        command: config.command,
        args: config.args,
        env: stdioEnvironment(config),
        cwd: workingDirectory(config.cwd),
      }),
      lifecycle,
    );
    return createMCPClient({
      clientName: "overtchat",
      transport,
      initializationOptions: initializationOptions(lifecycle),
      ...(lifecycle.onDisconnect
        ? { onUncaughtError: lifecycle.onDisconnect }
        : {}),
    });
  }

  return createMCPClient({
    clientName: "overtchat",
    initializationOptions: initializationOptions(lifecycle),
    ...(lifecycle.onDisconnect
      ? { onUncaughtError: lifecycle.onDisconnect }
      : {}),
    transport: {
      type: "http",
      url: config.url,
      headers: httpHeaders(config),
    },
  });
}

export async function listAllMcpTools(
  client: MCPClient,
  signal: AbortSignal,
): Promise<ListToolsResult> {
  const tools: ListToolsResult["tools"] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    if (cursor && !seenCursors.add(cursor)) {
      throw new Error("MCP tools/list returned a repeated pagination cursor");
    }
    const page = await client.listTools({
      ...(cursor ? { params: { cursor } } : {}),
      options: { signal },
    });
    tools.push(...page.tools);
    if (tools.length > MAX_MCP_CATALOG_ITEMS) {
      throw new Error(
        `MCP tools/list exceeded the catalog limit of ${MAX_MCP_CATALOG_ITEMS} items`,
      );
    }
    cursor = page.nextCursor;
  } while (cursor);

  return { tools };
}

export function mcpSetupSignal(): AbortSignal {
  return AbortSignal.timeout(MCP_SETUP_TIMEOUT_MS);
}
