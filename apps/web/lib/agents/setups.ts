import type {
  AgentConnectionListItem,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import { agentSessionActivityAt } from "@/lib/agents/attention";

/** An agent and workspace a new session can start with. */
export type AgentSetup = {
  workspaceId: string;
  provider: AgentProviderId;
  workspaceName: string;
  workspacePath: string;
  hostId: string;
  hostLabel: string;
  transport: AgentConnectionListItem["host"]["transport"];
  /** Latest activity of the setup's sessions; 0 when it has none. */
  activityAt: number;
};

/**
 * Every setup, most recently used first. Setups without sessions follow in
 * list order, so a fresh install still opens its first workspace.
 */
export function recentAgentSetups(
  connections: readonly AgentConnectionListItem[],
): AgentSetup[] {
  const setups: AgentSetup[] = [];
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      setups.push({
        workspaceId: workspace.id,
        provider: connection.provider,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        hostId: connection.host.id,
        hostLabel: connection.host.sshAlias || connection.host.name,
        transport: connection.host.transport,
        activityAt: Math.max(
          0,
          ...workspace.sessions.map(agentSessionActivityAt),
        ),
      });
    }
  }
  // Array sort is stable, so equal activity keeps list order.
  return setups.sort((left, right) => right.activityAt - left.activityAt);
}

export type AgentSetupHost = Pick<AgentSetup, "hostId" | "hostLabel" | "transport">;

/** Each machine once, in the order its setups were last used. */
export function agentSetupHosts(setups: readonly AgentSetup[]): AgentSetupHost[] {
  const hosts: AgentSetupHost[] = [];
  for (const setup of setups) {
    if (hosts.some((host) => host.hostId === setup.hostId)) continue;
    hosts.push({
      hostId: setup.hostId,
      hostLabel: setup.hostLabel,
      transport: setup.transport,
    });
  }
  return hosts;
}

/**
 * Each folder on the machine once, in the order its setups were last used,
 * each represented by its most recently used agent.
 */
export function agentSetupWorkspaces(
  setups: readonly AgentSetup[],
  hostId: string,
): AgentSetup[] {
  const workspaces: AgentSetup[] = [];
  for (const setup of setups) {
    if (setup.hostId !== hostId) continue;
    if (workspaces.some((item) => item.workspacePath === setup.workspacePath)) {
      continue;
    }
    workspaces.push(setup);
  }
  return workspaces;
}

/** The agents on the machine that have the folder, in last-used order. */
export function agentSetupsForWorkspace(
  setups: readonly AgentSetup[],
  hostId: string,
  workspacePath: string,
): AgentSetup[] {
  return setups.filter(
    (setup) => setup.hostId === hostId && setup.workspacePath === workspacePath,
  );
}

/**
 * The setup to open when the folder changes: the agent already chosen if the
 * folder has it, otherwise the folder's most recently used agent.
 */
export function agentSetupForWorkspace(
  setups: readonly AgentSetup[],
  hostId: string,
  workspacePath: string,
  provider: AgentProviderId,
): AgentSetup | undefined {
  const candidates = agentSetupsForWorkspace(setups, hostId, workspacePath);
  return (
    candidates.find((setup) => setup.provider === provider) ?? candidates[0]
  );
}
