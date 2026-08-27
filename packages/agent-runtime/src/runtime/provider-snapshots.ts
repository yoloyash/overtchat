import {
  AGENT_PROVIDERS,
  type AgentDiscoveryTarget,
  type AgentProviderSnapshot,
  type DetectedAgentInstallation,
} from "@overtchat/agent-bridge";
import {
  discoverAgentInstallations,
  targetForDiscovery,
} from "./discovery";
import type { HostTarget } from "./process";

type DiscoverProviders = (
  target: HostTarget,
) => Promise<DetectedAgentInstallation[]>;

function snapshotKey(target: AgentDiscoveryTarget): string {
  return JSON.stringify([
    target.transport,
    target.transport === "ssh" ? target.sshAlias : "",
  ]);
}

export class AgentProviderSnapshotManager {
  private readonly snapshots = new Map<string, AgentProviderSnapshot>();
  private readonly loads = new Map<string, Promise<AgentProviderSnapshot>>();

  constructor(
    private readonly discover: DiscoverProviders = discoverAgentInstallations,
    private readonly now: () => number = Date.now,
  ) {}

  getSnapshot(
    target: AgentDiscoveryTarget,
    options: { refresh?: boolean } = {},
  ): Promise<AgentProviderSnapshot> {
    const key = snapshotKey(target);
    const active = this.loads.get(key);
    if (active) return active;
    const current = this.snapshots.get(key);
    if (current && !options.refresh) return Promise.resolve(current);

    const load = this.load(target).finally(() => {
      if (this.loads.get(key) === load) this.loads.delete(key);
    });
    this.loads.set(key, load);
    return load;
  }

  private async load(
    target: AgentDiscoveryTarget,
  ): Promise<AgentProviderSnapshot> {
    const installations = await this.discover(targetForDiscovery(target));
    const ready = new Map(
      installations.map((installation) => [
        installation.provider,
        installation,
      ]),
    );
    const snapshot: AgentProviderSnapshot = {
      target,
      providers: Object.values(AGENT_PROVIDERS).map(({ id }) => {
        const installation = ready.get(id);
        return installation
          ? { ...installation, status: "ready" as const }
          : { provider: id, status: "unavailable" as const };
      }),
      refreshedAt: this.now(),
    };
    this.snapshots.set(snapshotKey(target), snapshot);
    return snapshot;
  }
}
