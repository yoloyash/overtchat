"use client";

import { Link, useLocation } from "@tanstack/react-router";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AgentProviderLogo,
  AgentSessionReadToggle,
  AgentSessionStatusIcon,
  agentSessionCanToggleRead,
  agentSessionStateLabel,
} from "@/components/agents/AgentSessionStatus";
import { useSidebar } from "@/components/sidebar-context";
import {
  agentSessionNeedsOwner,
  formatAgentSessionAge,
  formatAgentWorkingTime,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentWorkspaceHostLabel } from "@/lib/agents/search";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { cn } from "@/lib/utils";

/**
 * Where a row is listed: among every workspace, where the second line names
 * the workspace, or under its own workspace, where it shows the last reply.
 */
export type AgentSessionRowContext = "all" | "workspace";

export function agentSessionRowTitle(entry: AgentAttentionItem): string {
  return agentSessionDisplayTitle(entry.item.session) || "New session";
}

/** The second line of a row: what the session needs, or where it is. */
export function agentSessionRowDetail(
  entry: AgentAttentionItem,
  context: AgentSessionRowContext,
): string {
  const { item, group, state } = entry;
  const { session } = item;
  if (session.attention) {
    return [session.attention.title, session.attention.detail]
      .filter(Boolean)
      .join(" · ");
  }
  if (state === "failed") return session.lastTurn?.error || "The last turn failed.";
  if (state === "unread") return session.lastTurn?.preview || "Finished";
  if (context === "all") {
    return `${group.name} · ${agentWorkspaceHostLabel(group)}`;
  }
  return (
    (state === "idle" && session.lastTurn?.preview) ||
    agentProviderMetadata(item.provider).label
  );
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
  const emphasized = state !== "idle" && state !== "working";
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
          "block min-w-0 rounded-md py-1.5 pr-2 pl-2 text-xs outline-none motion-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
          active && "bg-sidebar-accent",
        )}
      >
        {state !== "idle" && (
          <span className="sr-only">{agentSessionStateLabel(state)}:</span>
        )}
        <span className="block min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate leading-4 text-sidebar-foreground",
                emphasized && "font-medium text-foreground",
              )}
            >
              {title}
            </span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1 text-[10px] leading-4 tabular-nums text-muted-foreground",
                // Hovering swaps the status for marking the session read or unread.
                toggleable &&
                  "group-has-[:focus-visible]:invisible [@media(hover:hover)]:group-hover:invisible [@media(hover:none)]:group-has-[:focus-visible]:visible",
              )}
            >
              <AgentSessionStatusIcon state={state} className="size-3" />
              {agentSessionRowTime(entry, now)}
            </span>
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <AgentProviderLogo provider={provider} className="size-3" />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground",
                state === "failed" && "text-destructive/90",
                agentSessionNeedsOwner(state) &&
                  state !== "failed" &&
                  "text-amber-600 dark:text-amber-400/90",
              )}
            >
              {agentSessionRowDetail(entry, context)}
            </span>
          </span>
        </span>
      </Link>
      {toggleable && (
        <span className="absolute top-1 right-1 flex size-5 items-center justify-center">
          <AgentSessionReadToggle session={session} state={state} title={title} />
        </span>
      )}
    </li>
  );
}
