import type {
  AgentConnectionListItem,
  AgentDiscoveryTarget,
  AgentProviderId,
  AgentProviderSnapshot,
} from "@overtchat/agent-bridge";
import { agentSessionActivityAt } from "@overtchat/shared/agent-attention";
import {
  agentWorkspaceAgents,
  type AgentWorkspaceAgent,
} from "@overtchat/shared/agent-creation";
import {
  agentConnectionTarget,
  agentHostLabel,
  agentTargetKey,
} from "@/lib/agents/workspaces";

/** An agent and workspace a new session can start with, as on the web. */
export type AgentSetup = {
  workspaceId: string;
  provider: AgentProviderId;
  workspaceName: string;
  workspacePath: string;
  /** The machine, as the connector reaches it; see `agentTargetKey`. */
  hostKey: string;
  hostLabel: string;
  transport: AgentConnectionListItem["host"]["transport"];
  /** The machine as the connector reaches it, for asking what it has. */
  target: AgentDiscoveryTarget;
  /** Latest activity of the setup's sessions; 0 when it has none. */
  activityAt: number;
};

export type AgentSetupAgent = AgentWorkspaceAgent;

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
      const target = agentConnectionTarget(connection);
      setups.push({
        workspaceId: workspace.id,
        provider: connection.provider,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        hostKey: agentTargetKey(target),
        hostLabel: agentHostLabel(connection.host),
        transport: connection.host.transport,
        target,
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

export type AgentSetupHost = Pick<AgentSetup, "hostKey" | "hostLabel" | "transport">;

/** Each machine once, in the order its setups were last used. */
export function agentSetupHosts(setups: readonly AgentSetup[]): AgentSetupHost[] {
  const hosts: AgentSetupHost[] = [];
  for (const setup of setups) {
    if (hosts.some((host) => host.hostKey === setup.hostKey)) continue;
    hosts.push({
      hostKey: setup.hostKey,
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
  hostKey: string,
): AgentSetup[] {
  const workspaces: AgentSetup[] = [];
  for (const setup of setups) {
    if (setup.hostKey !== hostKey) continue;
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
  hostKey: string,
  workspacePath: string,
): AgentSetup[] {
  return setups.filter(
    (setup) => setup.hostKey === hostKey && setup.workspacePath === workspacePath,
  );
}

/**
 * The agents a new session can start with in the folder: those with the
 * folder in last-used order, then the rest the machine has.
 */
export function agentSetupAgentsForWorkspace(
  setups: readonly AgentSetup[],
  hostKey: string,
  workspacePath: string,
  snapshot: AgentProviderSnapshot | undefined,
): AgentSetupAgent[] {
  return agentWorkspaceAgents(
    agentSetupsForWorkspace(setups, hostKey, workspacePath),
    snapshot,
  );
}

/**
 * The agent to open when the folder changes: the agent already chosen when
 * the folder's machine has it, otherwise the folder's most recently used
 * agent.
 */
export function agentSetupForWorkspace(
  setups: readonly AgentSetup[],
  hostKey: string,
  workspacePath: string,
  provider: AgentProviderId,
  snapshot: AgentProviderSnapshot | undefined,
): AgentSetupAgent | undefined {
  const agents = agentSetupAgentsForWorkspace(
    setups,
    hostKey,
    workspacePath,
    snapshot,
  );
  return (
    agents.find((agent) => agent.provider === provider && agent.detected) ??
    agents[0]
  );
}
