import "server-only";
import type { MCPClient } from "@ai-sdk/mcp";
import { mcpToolNames } from "@overtchat/shared";
import type { ToolSet } from "ai";
import type { McpServerRow } from "@/lib/db/mcpServers";
import {
  createConfiguredMcpClient,
  listAllMcpTools,
  MCP_TOOL_TIMEOUT_MS,
  mcpSetupSignal,
} from "@/lib/mcp/client";

type ConnectionState = { connected: boolean };

export type McpConnectionFactory = (
  server: McpServerRow,
) => Promise<McpConnection>;

export type McpBinding = {
  tools: ToolSet;
  release(): Promise<void>;
};

type RuntimeSnapshot = {
  desiredRevision: string;
  servers: Map<string, McpServerView>;
  failedServerIds: Set<string>;
  tools: ToolSet;
};

type McpServerView = {
  server: McpServerRow;
  connection: McpConnection;
};

export function mcpServerRevision(server: McpServerRow): string {
  return JSON.stringify({
    name: server.name,
    availability: server.availability,
    config: server.config,
    updatedAt: server.updatedAt.getTime(),
  });
}

export function mcpConnectionRevision(server: McpServerRow): string {
  return JSON.stringify(server.config);
}

function desiredRevision(servers: McpServerRow[]): string {
  return JSON.stringify(
    servers
      .map((server) => [server.id, mcpServerRevision(server)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function timeoutTool(tool: ToolSet[string]): ToolSet[string] {
  const execute = tool.execute;
  if (!execute) return tool;

  return {
    ...tool,
    async execute(input: unknown, options: Parameters<typeof execute>[1]) {
      const timeoutSignal = AbortSignal.timeout(MCP_TOOL_TIMEOUT_MS);
      const abortSignal = options.abortSignal
        ? AbortSignal.any([options.abortSignal, timeoutSignal])
        : timeoutSignal;
      return execute(input, { ...options, abortSignal });
    },
  } as ToolSet[string];
}

export class McpConnection {
  private references = 0;
  private closing: Promise<void> | null = null;

  constructor(
    readonly revision: string,
    readonly client: MCPClient,
    readonly rawTools: ToolSet,
    private readonly state: ConnectionState,
  ) {}

  get reusable(): boolean {
    return this.state.connected && this.closing === null;
  }

  retain(): void {
    if (this.closing) throw new Error("Cannot retain a closing MCP connection");
    this.references += 1;
  }

  async release(): Promise<void> {
    if (this.references === 0) return;
    this.references -= 1;
    if (this.references === 0) await this.close();
  }

  close(): Promise<void> {
    this.state.connected = false;
    this.closing ??= this.client.close().catch(() => undefined);
    return this.closing;
  }
}

export async function connectMcpServer(
  server: McpServerRow,
): Promise<McpConnection> {
  const state: ConnectionState = { connected: true };
  const setupSignal = mcpSetupSignal();
  const client = await createConfiguredMcpClient(server.config, {
    initializationSignal: setupSignal,
    onDisconnect: () => {
      state.connected = false;
    },
  });

  try {
    const definitions = await listAllMcpTools(client, setupSignal);
    const converted = client.toolsFromDefinitions(definitions);
    const rawTools: ToolSet = {};
    for (const [name, tool] of Object.entries(converted)) {
      rawTools[name] = timeoutTool(tool as ToolSet[string]);
    }
    return new McpConnection(
      mcpConnectionRevision(server),
      client,
      rawTools,
      state,
    );
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

function toolsForServers(servers: Map<string, McpServerView>): ToolSet {
  const catalog = [...servers.values()].flatMap(({ server, connection }) =>
    Object.entries(connection.rawTools).map(([toolName, tool]) => ({
      server,
      toolName,
      tool,
    })),
  );
  const names = mcpToolNames(
    catalog.map(({ server, toolName }) => ({
      server,
      toolName,
    })),
  );
  const tools: ToolSet = {};
  catalog.forEach(({ tool }, index) => {
    const name = names[index];
    if (name) tools[name] = tool;
  });
  return tools;
}

/** Owns the live MCP connections for exactly one OvertChat conversation. */
export class McpRuntime {
  private current: RuntimeSnapshot | null = null;
  private operation: Promise<void> = Promise.resolve();
  private activeBindings = 0;
  private closed = false;

  constructor(
    private readonly connect: McpConnectionFactory = connectMcpServer,
  ) {}

  get inUse(): boolean {
    return this.activeBindings > 0;
  }

  acquire(servers: McpServerRow[]): Promise<McpBinding> {
    return this.exclusive(async () => {
      if (this.closed) throw new Error("MCP runtime is closed");
      const snapshot = await this.reconcile(servers);
      const connections = [...snapshot.servers.values()].map(
        ({ connection }) => connection,
      );
      for (const connection of connections) connection.retain();
      this.activeBindings += 1;

      let released = false;
      return {
        tools: snapshot.tools,
        release: async () => {
          if (released) return;
          released = true;
          this.activeBindings -= 1;
          await Promise.allSettled(
            connections.map((connection) => connection.release()),
          );
        },
      };
    });
  }

  invalidate(serverId: string, disconnect = true): Promise<void> {
    return this.exclusive(async () => {
      const current = this.current;
      if (!current) return;

      const servers = new Map(current.servers);
      if (!disconnect) {
        current.desiredRevision = "";
        return;
      }
      if (!servers.delete(serverId)) {
        current.desiredRevision = "";
        current.failedServerIds.add(serverId);
        return;
      }

      const next: RuntimeSnapshot = {
        desiredRevision: "",
        servers,
        failedServerIds: new Set([...current.failedServerIds, serverId]),
        tools: toolsForServers(servers),
      };
      await this.publish(next);
    });
  }

  close(): Promise<void> {
    return this.exclusive(async () => {
      if (this.closed) return;
      this.closed = true;
      const current = this.current;
      this.current = null;
      if (current) {
        await Promise.allSettled(
          [...current.servers.values()].map(({ connection }) =>
            connection.release(),
          ),
        );
      }
    });
  }

  closeOnExit(): void {
    this.closed = true;
    for (const view of this.current?.servers.values() ?? []) {
      void view.connection.close();
    }
    this.current = null;
  }

  private async reconcile(servers: McpServerRow[]): Promise<RuntimeSnapshot> {
    const revision = desiredRevision(servers);
    const current = this.current;
    if (
      current?.desiredRevision === revision &&
      current.failedServerIds.size === 0 &&
      [...current.servers.values()].every(
        ({ connection }) => connection.reusable,
      )
    ) {
      return current;
    }

    const settled = await Promise.allSettled(
      servers.map(async (server) => {
        const existing = current?.servers.get(server.id)?.connection;
        const expectedRevision = mcpConnectionRevision(server);
        if (existing?.revision === expectedRevision && existing.reusable) {
          return { server, connection: existing };
        }
        return { server, connection: await this.connect(server) };
      }),
    );
    const connectedServers = new Map<string, McpServerView>();
    const failedServerIds = new Set<string>();

    settled.forEach((result, index) => {
      const server = servers[index];
      if (!server) return;
      if (result.status === "fulfilled") {
        connectedServers.set(server.id, result.value);
      } else {
        failedServerIds.add(server.id);
        console.warn(
          `[mcp] Failed to connect to ${JSON.stringify(server.name)}:`,
          result.reason,
        );
      }
    });

    const next: RuntimeSnapshot = {
      desiredRevision: revision,
      servers: connectedServers,
      failedServerIds,
      tools: toolsForServers(connectedServers),
    };
    await this.publish(next);
    return next;
  }

  private async publish(next: RuntimeSnapshot): Promise<void> {
    const previous = this.current;
    const retained: McpConnection[] = [];
    try {
      for (const { connection } of next.servers.values()) {
        connection.retain();
        retained.push(connection);
      }
    } catch (error) {
      await Promise.allSettled(
        retained.map((connection) => connection.release()),
      );
      throw error;
    }

    this.current = next;
    if (previous) {
      await Promise.allSettled(
        [...previous.servers.values()].map(({ connection }) =>
          connection.release(),
        ),
      );
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.operation.then(work, work);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
