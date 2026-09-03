import type { AgentProviderCatalog } from "@overtchat/agent-bridge";
import { agentProviderAdapter } from "@overtchat/agent-runtime/providers/registry";
import type { AgentWorkspaceDescriptor } from "@overtchat/agent-runtime/runtime/registry";

const DEFAULT_CATALOG_TTL_MS = 5 * 60_000;
const MAX_CACHED_CATALOGS = 128;

type CachedCatalog = {
  catalog: AgentProviderCatalog;
  expiresAt: number;
  usedAt: number;
};

function catalogKey(descriptor: AgentWorkspaceDescriptor): string {
  return JSON.stringify([
    descriptor.provider,
    descriptor.target.transport,
    descriptor.target.transport === "ssh" ? descriptor.target.alias : "",
    descriptor.target.shellMode ?? "interactive",
    descriptor.executable,
    descriptor.detectedVersion ?? "",
    descriptor.cwd,
  ]);
}

export class AgentProviderCatalogManager {
  private readonly catalogs = new Map<string, CachedCatalog>();
  private readonly loads = new Map<string, Promise<AgentProviderCatalog>>();

  constructor(
    private readonly ttlMs = DEFAULT_CATALOG_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  getCatalog(
    descriptor: AgentWorkspaceDescriptor,
    options: { refresh?: boolean } = {},
  ): Promise<AgentProviderCatalog> {
    const key = catalogKey(descriptor);
    const active = this.loads.get(key);
    if (active) return active;
    const current = this.catalogs.get(key);
    const now = this.now();
    if (current && !options.refresh && current.expiresAt > now) {
      current.usedAt = now;
      return Promise.resolve(current.catalog);
    }
    if (current) this.catalogs.delete(key);

    const load = this.load(descriptor, key).finally(() => {
      if (this.loads.get(key) === load) this.loads.delete(key);
    });
    this.loads.set(key, load);
    return load;
  }

  invalidate(descriptor: AgentWorkspaceDescriptor): void {
    this.catalogs.delete(catalogKey(descriptor));
  }

  private async load(
    descriptor: AgentWorkspaceDescriptor,
    key: string,
  ): Promise<AgentProviderCatalog> {
    const startedAt = this.now();
    const adapter = agentProviderAdapter(descriptor.provider);
    const catalog = await adapter.fetchCatalog(descriptor.target, {
      executable: descriptor.executable,
      cwd: descriptor.cwd,
      detectedVersion: descriptor.detectedVersion,
    });
    const loadedAt = this.now();
    this.catalogs.set(key, {
      catalog,
      expiresAt: loadedAt + this.ttlMs,
      usedAt: loadedAt,
    });
    this.prune();
    const elapsedMs = loadedAt - startedAt;
    if (elapsedMs >= 250) {
      console.info(
        `[connector:timing] catalog_load provider=${descriptor.provider} transport=${descriptor.target.transport} elapsed_ms=${elapsedMs}`,
      );
    }
    return catalog;
  }

  private prune(): void {
    if (this.catalogs.size <= MAX_CACHED_CATALOGS) return;
    const oldest = [...this.catalogs.entries()].sort(
      ([, left], [, right]) => left.usedAt - right.usedAt,
    );
    for (const [key] of oldest.slice(
      0,
      this.catalogs.size - MAX_CACHED_CATALOGS,
    )) {
      this.catalogs.delete(key);
    }
  }
}
