import { describe, expect, it, vi } from "vitest";
import { AgentProviderSnapshotManager } from "./provider-snapshots";

describe("AgentProviderSnapshotManager", () => {
  it("warms lazily, caches per target, and refreshes explicitly", async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce([
        {
          provider: "opencode",
          executable: "/usr/bin/opencode",
          version: "1.2.3",
          shellMode: "interactive",
        },
      ])
      .mockResolvedValueOnce([]);
    const manager = new AgentProviderSnapshotManager(discover, () => 123);
    const target = { connectorId: "connector", transport: "local" as const };

    const first = await manager.getSnapshot(target);
    const cached = await manager.getSnapshot(target);
    const refreshed = await manager.getSnapshot(target, { refresh: true });

    expect(first.providers).toContainEqual({
      provider: "opencode",
      status: "ready",
      executable: "/usr/bin/opencode",
      version: "1.2.3",
      shellMode: "interactive",
    });
    expect(cached).toBe(first);
    expect(refreshed.providers).toContainEqual({
      provider: "opencode",
      status: "unavailable",
    });
    expect(discover).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent warm-up and keeps the last good snapshot on error", async () => {
    let finish: ((value: []) => void) | undefined;
    const discover = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<[]>((resolve) => {
          finish = resolve;
        }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const manager = new AgentProviderSnapshotManager(discover);
    const target = {
      connectorId: "connector",
      transport: "ssh" as const,
      sshAlias: "server",
    };

    const left = manager.getSnapshot(target);
    const right = manager.getSnapshot(target);
    expect(discover).toHaveBeenCalledOnce();
    finish?.([]);
    const first = await left;
    await expect(right).resolves.toBe(first);
    await expect(
      manager.getSnapshot(target, { refresh: true }),
    ).rejects.toThrow("offline");
    await expect(manager.getSnapshot(target)).resolves.toBe(first);
  });
});
