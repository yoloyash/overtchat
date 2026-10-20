import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchCatalog: vi.fn() }));

vi.mock("@overtchat/agent-runtime/providers/registry", () => ({
  agentProviderAdapter: () => ({ fetchCatalog: mocks.fetchCatalog }),
}));

import { AgentProviderCatalogManager } from "./provider-catalogs";

const descriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "codex" as const,
  target: {
    transport: "ssh" as const,
    alias: "macbook",
    shellMode: "login" as const,
  },
  executable: "/usr/local/bin/codex",
  detectedVersion: "1.2.3",
  cwd: "/workspace",
};

const catalog = {
  provider: "codex" as const,
  models: [
    {
      provider: "codex" as const,
      id: "model",
      label: "Model",
      api: "codex-app-server",
      baseUrl: "",
      reasoning: true,
      input: ["text" as const],
      contextWindow: null,
      maxTokens: null,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  ],
  modes: [],
  defaultModeId: null,
};

describe("AgentProviderCatalogManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCatalog.mockResolvedValue(catalog);
  });

  it("reuses a catalog and deduplicates concurrent cold loads", async () => {
    let now = 100;
    const manager = new AgentProviderCatalogManager(1_000, () => now);

    const [left, right] = await Promise.all([
      manager.getCatalog(descriptor),
      manager.getCatalog(descriptor),
    ]);
    now = 500;
    const cached = await manager.getCatalog(descriptor);

    expect(left).toBe(catalog);
    expect(right).toBe(catalog);
    expect(cached).toBe(catalog);
    expect(mocks.fetchCatalog).toHaveBeenCalledOnce();
  });

  it("refreshes expired and invalidated catalogs", async () => {
    let now = 100;
    const manager = new AgentProviderCatalogManager(1_000, () => now);

    await manager.getCatalog(descriptor);
    now = 1_101;
    await manager.getCatalog(descriptor);
    manager.invalidate(descriptor);
    await manager.getCatalog(descriptor);

    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("separates catalogs by workspace and executable version", async () => {
    const manager = new AgentProviderCatalogManager();

    await manager.getCatalog(descriptor);
    await manager.getCatalog({ ...descriptor, cwd: "/other" });
    await manager.getCatalog({ ...descriptor, detectedVersion: "2.0.0" });

    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed loads", async () => {
    const manager = new AgentProviderCatalogManager();
    mocks.fetchCatalog
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce(catalog);

    await expect(manager.getCatalog(descriptor)).rejects.toThrow(
      "catalog unavailable",
    );
    await expect(manager.getCatalog(descriptor)).resolves.toBe(catalog);

    expect(mocks.fetchCatalog).toHaveBeenCalledTimes(2);
  });
});
