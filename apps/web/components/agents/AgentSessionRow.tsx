"use client";

import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AgentSessionReadToggle,
  AgentSessionStatusIcon,
  agentSessionCanToggleRead,
  agentSessionStateLabel,
} from "@/components/agents/AgentSessionStatus";
import { useSidebar } from "@/components/sidebar-context";
import {
  formatAgentSessionAge,
  formatAgentWorkingTime,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentWorkspaceHostLabel } from "@/lib/agents/search";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { cn } from "@/lib/utils";

/**
 * Where a row is listed: among every workspace, where the second line names
 * the workspace, or under its own workspace, where it names the agent.
 */
export type AgentSessionRowContext = "all" | "workspace";

export function agentSessionRowTitle(entry: AgentAttentionItem): string {
  return agentSessionDisplayTitle(entry.item.session) || "New session";
}

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
    ? `${group.name} · ${agentWorkspaceHostLabel(group)}`
    : agentProviderMetadata(item.provider).label;
}

/** How long a session has been working, or how long ago it last changed. */
export function agentSessionRowTime(entry: AgentAttentionItem, now: number): string {
  return entry.state === "working"
    ? formatAgentWorkingTime(now - entry.since)
    : formatAgentSessionAge(entry.since, now);
}

/** One agent session in the sidebar, in either grouping. */
export function AgentSessionRow({
  entry,
  now,
  context,
  onNavigate,
}: {
  entry: AgentAttentionItem;
  now: number;
  context: AgentSessionRowContext;
  onNavigate?: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { closeMobile } = useSidebar();
  const { item, group, state } = entry;
  const { session, provider } = item;
  const title = agentSessionRowTitle(entry);
  const active = pathname === `/agents/${session.id}`;
  const toggleable = agentSessionCanToggleRead(session, state);
  return (
    <li className="group relative">
      <Link
        to="/agents/$id"
        params={{ id: session.id }}
        onClick={() => {
          onNavigate?.();
          closeMobile();
        }}
        aria-current={active ? "page" : undefined}
        title={`${title} · ${agentProviderMetadata(provider).label} · ${group.name} · ${agentWorkspaceHostLabel(group)}`}
        className={cn(
          "flex min-w-0 items-start gap-2 rounded-lg py-2 pr-2 pl-4 outline-none motion-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring",
          active && "bg-sidebar-accent",
        )}
      >
        {state !== "idle" && (
          <span className="sr-only">{agentSessionStateLabel(state)}:</span>
        )}
        <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
          <AgentSessionStatusIcon state={state} />
        </span>
        <span className="block min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm leading-5 text-sidebar-foreground/75 motion-colors group-hover:text-sidebar-foreground",
                active && "text-sidebar-foreground",
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                "shrink-0 text-xs leading-5 tabular-nums text-muted-foreground/70",
                // Hovering swaps the time for marking the session read or unread.
                toggleable &&
                  "group-has-[:focus-visible]:invisible [@media(hover:hover)]:group-hover:invisible [@media(hover:none)]:group-has-[:focus-visible]:visible",
              )}
            >
              {agentSessionRowTime(entry, now)}
            </span>
          </span>
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {agentSessionRowMeta(entry, context)}
          </span>
        </span>
      </Link>
      {toggleable && (
        <span className="absolute top-2 right-1 flex size-5 items-center justify-center">
          <AgentSessionReadToggle session={session} state={state} title={title} />
        </span>
      )}
    </li>
  );
}

/** Ends a shortened list of rows, in the rows' own geometry. */
export function AgentSessionListToggle({
  expanded,
  hiddenCount,
  onToggle,
  controls,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
  controls?: string;
}) {
  const Icon = expanded ? ChevronUp : ChevronDown;
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-4 text-left text-sm text-muted-foreground outline-none motion-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
      >
        <span className="flex w-3.5 shrink-0 justify-center">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span>{expanded ? "Show less" : `Show ${hiddenCount} more`}</span>
      </button>
    </li>
  );
}
