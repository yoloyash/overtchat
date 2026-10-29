import type { AgentProviderId } from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  agentSessionActivityAt,
  agentSessionState,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { agentHostLabel, type AgentWorkspaceGroup } from "@/lib/agents/workspaces";

export type AgentSessionSort = "activity" | "created";

export type AgentSessionSearch = {
  query: string;
  /** A host id, or null for every machine. */
  host: string | null;
  /** A folder name, or null for every folder. */
  workspace: string | null;
  provider: AgentProviderId | null;
  sort: AgentSessionSort;
};

export type AgentSessionHost = { id: string; label: string };

/** Each machine with sessions, once, in list order. */
export function agentSessionHosts(
  groups: readonly AgentWorkspaceGroup[],
): AgentSessionHost[] {
  const hosts: AgentSessionHost[] = [];
  for (const group of groups) {
    if (group.sessions.length === 0) continue;
    if (hosts.some((host) => host.id === group.host.id)) continue;
    hosts.push({ id: group.host.id, label: agentHostLabel(group.host) });
  }
  return hosts;
}

/** The folders with sessions on the machine, or on every machine, by name. */
export function agentSessionWorkspaces(
  groups: readonly AgentWorkspaceGroup[],
  host: string | null,
): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    if (group.sessions.length === 0) continue;
    if (host && group.host.id !== host) continue;
    names.add(group.name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/** The agents with sessions in the folder on the machine, or wider when either is null. */
export function agentSessionProviders(
  groups: readonly AgentWorkspaceGroup[],
  host: string | null,
  workspace: string | null,
): AgentProviderId[] {
  const providers = new Set<AgentProviderId>();
  for (const group of groups) {
    if (host && group.host.id !== host) continue;
    if (workspace && group.name !== workspace) continue;
    for (const item of group.sessions) providers.add(item.provider);
  }
  return [...providers].sort();
}

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Every word of the query must appear in a session's title, messages, or setup. */
function searchableText(entry: AgentAttentionItem): string {
  const { item, group } = entry;
  const { session } = item;
  return fold(
    [
      agentSessionDisplayTitle(session),
      session.firstMessage,
      session.lastTurn?.preview,
      session.lastTurn?.error,
      session.attention?.title,
      session.attention?.detail,
      group.name,
      group.path,
      agentHostLabel(group.host),
      agentProviderMetadata(item.provider).label,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** When a session started, falling back to its latest activity. */
export function agentSessionCreatedAt(entry: AgentAttentionItem): number {
  return entry.item.session.createdAt ?? agentSessionActivityAt(entry.item.session);
}

/** Sessions matching a search, newest first by the chosen sort. */
export function searchAgentSessions(
  groups: readonly AgentWorkspaceGroup[],
  search: AgentSessionSearch,
): AgentAttentionItem[] {
  const words = fold(search.query).split(/\s+/).filter(Boolean);
  const results: AgentAttentionItem[] = [];
  for (const group of groups) {
    if (search.host && group.host.id !== search.host) continue;
    if (search.workspace && group.name !== search.workspace) continue;
    for (const item of group.sessions) {
      if (search.provider && item.provider !== search.provider) continue;
      const entry: AgentAttentionItem = {
        item,
        group,
        state: agentSessionState(item.session),
        since: agentSessionActivityAt(item.session),
      };
      if (words.length > 0) {
        const text = searchableText(entry);
        if (!words.every((word) => text.includes(word))) continue;
      }
      results.push(entry);
    }
  }
  const time =
    search.sort === "created"
      ? agentSessionCreatedAt
      : (entry: AgentAttentionItem) => entry.since;
  return results.sort((left, right) => time(right) - time(left));
}
