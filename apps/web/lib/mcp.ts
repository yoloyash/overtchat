import "server-only";
import type { ToolSet } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { McpServerRow } from "@/lib/db/tools";
import { namespacedMcpToolName } from "@/lib/mcpNames";
import type { McpServerTestResult } from "@/lib/toolConfig";

const MCP_CONNECT_TIMEOUT_MS = 10_000;
const MCP_LIST_TOOLS_TIMEOUT_MS = 10_000;

export interface BuiltMcpTools {
  tools: ToolSet;
  clients: MCPClient[];
  instructions: string[];
  skipped: Array<{ serverId: string; serverName: string; error: string }>;
}

export async function buildMcpTools(
  servers: McpServerRow[],
): Promise<BuiltMcpTools> {
  const tools: ToolSet = {};
  const clients: MCPClient[] = [];
  const instructions: string[] = [];
  const skipped: BuiltMcpTools["skipped"] = [];
  const usedToolNames = new Set<string>();

  for (const server of servers) {
    let client: MCPClient | null = null;
    try {
      client = await connectStdioServer(server);
      clients.push(client);

      const definitions = await withAbortTimeout(
        (signal) => client!.listTools({ options: { signal } }),
        MCP_LIST_TOOLS_TIMEOUT_MS,
        `Timed out while listing tools for ${server.name}`,
      );
      const serverTools = client.toolsFromDefinitions(definitions) as Record<
        string,
        unknown
      >;

      for (const [originalName, tool] of Object.entries(serverTools)) {
        const namespaced = namespacedMcpToolName(
          server.slug,
          originalName,
          usedToolNames,
        );
        tools[namespaced] = wrapMcpTool({
          tool,
          namespaced,
          originalName,
          server,
        });
      }

      if (client.instructions?.trim()) {
        instructions.push(
          `# MCP Server: ${server.name}\n${client.instructions.trim()}`,
        );
      }
    } catch (err) {
      skipped.push({
        serverId: server.id,
        serverName: server.name,
        error: errorMessage(err),
      });
      if (client) await client.close().catch(() => {});
    }
  }

  return { tools, clients, instructions, skipped };
}

export async function closeMcpClients(clients: MCPClient[]): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()));
}

export async function testMcpServer(
  server: Pick<
    McpServerRow,
    "name" | "slug" | "command" | "args" | "env" | "cwd"
  >,
): Promise<McpServerTestResult> {
  const startedAt = Date.now();
  let client: MCPClient | null = null;
  try {
    client = await connectStdioServer(server);
    const result = await withAbortTimeout(
      (signal) => client!.listTools({ options: { signal } }),
      MCP_LIST_TOOLS_TIMEOUT_MS,
      `Timed out while listing tools for ${server.name}`,
    );
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      serverInfo: {
        name: client.serverInfo.name,
        title: client.serverInfo.title,
        version: client.serverInfo.version,
      },
      instructions: client.instructions,
      tools: result.tools.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: errorMessage(err),
    };
  } finally {
    if (client) await client.close().catch(() => {});
  }
}

async function connectStdioServer(
  server: Pick<McpServerRow, "name" | "command" | "args" | "env" | "cwd">,
): Promise<MCPClient> {
  const transport = new Experimental_StdioMCPTransport({
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd ?? undefined,
  });

  try {
    return await withTimeout(
      createMCPClient({
        transport,
        clientName: "overtchat",
        version: "1.0.0",
        onUncaughtError: (error) => {
          console.error(`[mcp:${server.name}]`, error);
        },
      }),
      MCP_CONNECT_TIMEOUT_MS,
      `Timed out while connecting to ${server.name}`,
      () => transport.close().catch(() => {}),
    );
  } catch (err) {
    await transport.close().catch(() => {});
    throw err;
  }
}

function wrapMcpTool({
  tool,
  namespaced,
  originalName,
  server,
}: {
  tool: unknown;
  namespaced: string;
  originalName: string;
  server: McpServerRow;
}) {
  const source = isRecord(tool) ? tool : {};
  const existingMetadata = isRecord(source.metadata) ? source.metadata : {};
  const originalTitle =
    typeof source.title === "string" ? source.title : originalName;
  const originalDescription =
    typeof source.description === "string" ? source.description : "";

  return {
    ...source,
    title: `${server.name}: ${originalTitle}`,
    description: originalDescription
      ? `MCP tool from ${server.name} (${originalName}). ${originalDescription}`
      : `MCP tool from ${server.name} (${originalName}).`,
    metadata: {
      ...existingMetadata,
      source: "mcp",
      namespacedName: namespaced,
      serverId: server.id,
      serverName: server.name,
      serverSlug: server.slug,
      toolName: originalName,
      displayName: originalTitle,
    },
  } as unknown as ToolSet[string];
}

function withAbortTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(message);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  return Promise.race([fn(controller.signal), timeoutPromise]).finally(() =>
    clearTimeout(timeout),
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      onTimeout?.();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
