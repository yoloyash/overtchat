import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AGENT_ATTENTION_SECTIONS,
  agentAttentionSections,
  formatAgentSessionAge,
  formatAgentWorkingTime,
  mostUrgentAgentSessionState,
  type AgentAttentionEntry,
  type AgentSessionState,
} from "@overtchat/shared/agent-attention";
import {
  agentHostLabel,
  sessionTitle,
  type WorkspaceGroup,
} from "@/lib/agents/workspaces";

export type AgentAttentionItem = AgentAttentionEntry<WorkspaceGroup>;

/** How the drawer lists sessions: by what they need, or by folder. */
export type AgentDrawerGrouping = "status" | "workspace";

/** Only Done is shortened; every other group lists each session. */
export const AGENT_SESSION_PREVIEW_COUNT = 7;

/**
 * Where a row is listed: among every workspace, where the second line names
 * the workspace, or under its own workspace, where it names the agent.
 */
export type AgentSessionRowContext = "all" | "workspace";

/** The second line of a row: what the session is asking, or where it runs. */
export function agentSessionRowMeta(
  entry: AgentAttentionItem,
  context: AgentSessionRowContext,
): string {
  const { item, group } = entry;
  const { attention } = item.session;
  if (attention) {
    return [attention.title, attention.detail].filter(Boolean).join(" · ");
  }
  return context === "all"
    ? `${group.name} · ${agentHostLabel(group.host)}`
    : agentProviderMetadata(item.provider).label;
}

/** How long a session has been working, or how long ago it last changed. */
export function agentSessionRowTime(entry: AgentAttentionItem, now: number): string {
  return entry.state === "working"
    ? formatAgentWorkingTime(now - entry.since)
    : formatAgentSessionAge(entry.since, now);
}

export function agentSessionRowTitle(entry: AgentAttentionItem): string {
  return sessionTitle(entry.item.session);
}

export type AgentDrawerEntry =
  | {
      kind: "group";
      key: string;
      label: string;
      state: AgentSessionState;
      collapsed: boolean;
    }
  | {
      kind: "workspace";
      key: string;
      group: WorkspaceGroup;
      /** The most urgent state among the folder's sessions. */
      state: AgentSessionState;
      collapsed: boolean;
    }
  | {
      kind: "session";
      key: string;
      entry: AgentAttentionItem;
      context: AgentSessionRowContext;
    }
  | { kind: "more"; key: string; hidden: number; expanded: boolean }
  | { kind: "empty"; key: string; text: string };

export type AgentDrawerOptions = {
  grouping: AgentDrawerGrouping;
  /** Keys of folded status groups or workspaces. */
  collapsed: readonly string[];
  /** Whether Done lists every session. */
  showAllDone: boolean;
  /** The open session stays listed even when Done is shortened. */
  activeSessionId: string | null;
};

/**
 * The rows of the Agents drawer as one flat list, so a virtualized list can
 * render status groups and folders alike.
 */
export function agentDrawerEntries(
  groups: readonly WorkspaceGroup[],
  options: AgentDrawerOptions,
): AgentDrawerEntry[] {
  return options.grouping === "workspace"
    ? workspaceEntries(groups, options)
    : statusEntries(groups, options);
}

function statusEntries(
  groups: readonly WorkspaceGroup[],
  options: AgentDrawerOptions,
): AgentDrawerEntry[] {
  const sections = agentAttentionSections(groups);
  const entries: AgentDrawerEntry[] = [];
  for (const { key, label, state } of AGENT_ATTENTION_SECTIONS) {
    const items = sections[key];
    if (items.length === 0) continue;
    const collapsed = options.collapsed.includes(key);
    entries.push({ kind: "group", key, label, state, collapsed });
    if (collapsed) continue;
    const shown =
      key === "done" && !options.showAllDone
        ? items.filter(
            (entry, index) =>
              index < AGENT_SESSION_PREVIEW_COUNT ||
              entry.item.session.id === options.activeSessionId,
          )
        : items;
    for (const entry of shown) {
      entries.push({
        kind: "session",
        key: entry.item.session.id,
        entry,
        context: "all",
      });
    }
    if (key === "done" && items.length > AGENT_SESSION_PREVIEW_COUNT) {
      entries.push({
        kind: "more",
        key: "done-more",
        hidden: items.length - shown.length,
        expanded: options.showAllDone,
      });
    }
  }
  return entries.length
    ? entries
    : [{ kind: "empty", key: "empty", text: "No sessions yet." }];
}

function workspaceEntries(
  groups: readonly WorkspaceGroup[],
  options: AgentDrawerOptions,
): AgentDrawerEntry[] {
  const entries: AgentDrawerEntry[] = [];
  for (const group of groups) {
    const sections = agentAttentionSections([group]);
    const items = Object.values(sections).flat();
    const holdsActive = items.some(
      (entry) => entry.item.session.id === options.activeSessionId,
    );
    // The open session's folder stays open, as a project does for its chat.
    const collapsed = options.collapsed.includes(group.key) && !holdsActive;
    entries.push({
      kind: "workspace",
      key: group.key,
      group,
      state: mostUrgentAgentSessionState(group.sessions.map(({ session }) => session)),
      collapsed,
    });
    if (collapsed) continue;
    if (items.length === 0) {
      entries.push({ kind: "empty", key: `${group.key}:empty`, text: "No sessions yet." });
      continue;
    }
    for (const entry of items) {
      entries.push({
        kind: "session",
        key: entry.item.session.id,
        entry,
        context: "workspace",
      });
    }
  }
  return entries.length
    ? entries
    : [{ kind: "empty", key: "empty", text: "No workspaces yet." }];
}
