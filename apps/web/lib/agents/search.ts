import type { AgentProviderId } from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  agentSessionActivityAt,
  agentSessionState,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import type { AgentWorkspaceGroup } from "@/lib/agents/workspaces";

export type AgentSessionSort = "activity" | "created";

export type AgentSessionSearch = {
  query: string;
  /** A workspace group key, or null for every workspace. */
  workspace: string | null;
  provider: AgentProviderId | null;
  sort: AgentSessionSort;
};

export function agentWorkspaceHostLabel(
  group: Pick<AgentWorkspaceGroup, "host">,
): string {
  return group.host.sshAlias || group.host.name || "This server";
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
      agentWorkspaceHostLabel(group),
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
    if (search.workspace && group.key !== search.workspace) continue;
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
