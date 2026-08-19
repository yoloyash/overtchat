import "server-only";
import type { ToolSet } from "ai";
import type { McpServerRow } from "@/lib/db/mcpServers";
import {
  McpRuntime,
  type McpBinding,
  type McpConnectionFactory,
} from "@/lib/mcp/runtime";

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_MAX_IDLE_RUNTIMES = 32;

export type McpRuntimeScope = {
  userId: string;
  chatId: string;
};

type RuntimeEntry = {
  scope: McpRuntimeScope;
  runtime: McpRuntime;
  lastUsedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

export type ManagedMcpBinding = {
  tools: ToolSet;
  release(): Promise<void>;
};

function scopeKey(scope: McpRuntimeScope): string {
  return `${scope.userId.length}:${scope.userId}${scope.chatId}`;
}

export class McpManager {
  private readonly runtimes = new Map<string, RuntimeEntry>();

  constructor(
    private readonly options: {
      connect?: McpConnectionFactory;
      idleTimeoutMs?: number;
      maxIdleRuntimes?: number;
    } = {},
  ) {}

  async acquire(
    scope: McpRuntimeScope,
    servers: McpServerRow[],
  ): Promise<ManagedMcpBinding> {
    const key = scopeKey(scope);
    let entry = this.runtimes.get(key);
    if (!entry) {
      this.evictIdleForCapacity();
      entry = {
        scope,
        runtime: new McpRuntime(this.options.connect),
        lastUsedAt: Date.now(),
        idleTimer: null,
      };
      this.runtimes.set(key, entry);
    }
    this.touch(entry);

    let binding: McpBinding;
    try {
      binding = await entry.runtime.acquire(servers);
    } catch (error) {
      this.scheduleIdleClose(key, entry);
      throw error;
    }

    let released = false;
    return {
      tools: binding.tools,
      release: async () => {
        if (released) return;
        released = true;
        await binding.release();
        this.touch(entry);
        this.scheduleIdleClose(key, entry);
      },
    };
  }

  async invalidateServer(serverId: string, disconnect = true): Promise<void> {
    await Promise.allSettled(
      [...this.runtimes.values()].map((entry) =>
        entry.runtime.invalidate(serverId, disconnect),
      ),
    );
  }

  async invalidateUserServer(
    userId: string,
    serverId: string,
    disconnect = true,
  ): Promise<void> {
    await Promise.allSettled(
      [...this.runtimes.values()]
        .filter((entry) => entry.scope.userId === userId)
        .map((entry) => entry.runtime.invalidate(serverId, disconnect)),
    );
  }

  async closeScope(scope: McpRuntimeScope): Promise<void> {
    const key = scopeKey(scope);
    const entry = this.runtimes.get(key);
    if (!entry) return;
    this.runtimes.delete(key);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    await entry.runtime.close();
  }

  async closeAll(): Promise<void> {
    const entries = [...this.runtimes.values()];
    this.runtimes.clear();
    for (const entry of entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
    }
    await Promise.allSettled(entries.map((entry) => entry.runtime.close()));
  }

  closeAllOnExit(): void {
    const entries = [...this.runtimes.values()];
    this.runtimes.clear();
    for (const entry of entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      entry.runtime.closeOnExit();
    }
  }

  private touch(entry: RuntimeEntry): void {
    entry.lastUsedAt = Date.now();
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
  }

  private scheduleIdleClose(key: string, entry: RuntimeEntry): void {
    if (this.runtimes.get(key) !== entry || entry.runtime.inUse) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const idleTimeoutMs =
      this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (
        this.runtimes.get(key) !== entry ||
        entry.runtime.inUse ||
        Date.now() - entry.lastUsedAt < idleTimeoutMs
      ) {
        this.scheduleIdleClose(key, entry);
        return;
      }
      this.runtimes.delete(key);
      void entry.runtime.close();
    }, idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  private evictIdleForCapacity(): void {
    const maxIdleRuntimes =
      this.options.maxIdleRuntimes ?? DEFAULT_MAX_IDLE_RUNTIMES;
    if (this.runtimes.size < maxIdleRuntimes) return;

    const idle = [...this.runtimes.entries()]
      .filter(([, entry]) => !entry.runtime.inUse)
      .sort(([, left], [, right]) => left.lastUsedAt - right.lastUsedAt);
    while (this.runtimes.size >= maxIdleRuntimes && idle.length > 0) {
      const candidate = idle.shift();
      if (!candidate) break;
      const [key, entry] = candidate;
      if (this.runtimes.get(key) !== entry) continue;
      this.runtimes.delete(key);
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      void entry.runtime.close();
    }
  }
}

type McpGlobal = typeof globalThis & {
  __overtchatMcpManager?: McpManager;
  __overtchatMcpExitHandler?: boolean;
};

const mcpGlobal = globalThis as McpGlobal;
const manager = mcpGlobal.__overtchatMcpManager ?? new McpManager();
mcpGlobal.__overtchatMcpManager = manager;

if (!mcpGlobal.__overtchatMcpExitHandler) {
  mcpGlobal.__overtchatMcpExitHandler = true;
  process.once("exit", () => manager.closeAllOnExit());
}

export function acquireMcpBinding(
  scope: McpRuntimeScope,
  servers: McpServerRow[],
): Promise<ManagedMcpBinding> {
  return manager.acquire(scope, servers);
}

export function invalidateMcpServer(
  serverId: string,
  options: { disconnect?: boolean } = {},
): Promise<void> {
  return manager.invalidateServer(serverId, options.disconnect ?? true);
}

export function invalidateUserMcpServer(
  userId: string,
  serverId: string,
  options: { disconnect?: boolean } = {},
): Promise<void> {
  return manager.invalidateUserServer(
    userId,
    serverId,
    options.disconnect ?? true,
  );
}

export function closeChatMcpRuntime(
  scope: McpRuntimeScope,
): Promise<void> {
  return manager.closeScope(scope);
}
