"use client";

import { useId, useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, CircleDashed, Clock, Hand } from "lucide-react";
import type {
  AgentConnectionListItem,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import { AgentSessionRow } from "@/components/agents/AgentSessionRow";
import { AgentSessionStatusIcon } from "@/components/agents/AgentSessionStatus";
import {
  agentAttentionSections,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { groupAgentWorkspaces } from "@/lib/agents/workspaces";
import { useSetAgentSessionRead } from "@/lib/queries/agentSessionRead";
import { useNow } from "@/lib/useNow";

/** Recent sessions listed before "Show more"; the other sections list everything. */
export const RECENT_PREVIEW_COUNT = 7;

/** Every agent session, grouped by what it needs from its owner. */
export function SidebarAgentStatusList({
  connections,
  providerFilter,
}: {
  connections: AgentConnectionListItem[];
  providerFilter: AgentProviderId | null;
}) {
  const sections = useMemo(
    () => agentAttentionSections(groupAgentWorkspaces(connections), providerFilter),
    [connections, providerFilter],
  );
  const setRead = useSetAgentSessionRead();
  const [showAllRecent, setShowAllRecent] = useState(false);
  const recentListId = useId();
  const working = sections.working.length > 0;
  // Running times tick each second; ages only need the minute.
  const now = useNow(working ? 1_000 : 30_000);
  const pathname = useLocation({ select: (location) => location.pathname });
  // The open session stays listed when it is older than the preview.
  const recent = showAllRecent
    ? sections.recent
    : sections.recent.filter(
        ({ item }, index) =>
          index < RECENT_PREVIEW_COUNT ||
          pathname === `/agents/${item.session.id}`,
      );
  const hiddenRecent = sections.recent.length - recent.length;

  if (
    sections.needsYou.length +
      sections.ready.length +
      sections.working.length +
      sections.recent.length ===
    0
  ) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        No sessions yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 pb-1">
      <StatusSection
        label="Needs you"
        icon={<Hand aria-hidden="true" className="size-3.5 text-amber-500" />}
        items={sections.needsYou}
        now={now}
      />
      <StatusSection
        label="Ready to review"
        icon={<AgentSessionStatusIcon state="unread" />}
        items={sections.ready}
        now={now}
        action={
          <button
            type="button"
            onClick={() => {
              for (const { item } of sections.ready) {
                setRead.mutate({ sessionId: item.session.id, read: true });
              }
            }}
            className="rounded px-1 text-[11px] text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            Mark all read
          </button>
        }
      />
      <StatusSection
        label="Working"
        icon={<CircleDashed aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        items={sections.working}
        now={now}
      />
      <StatusSection
        label="Recent"
        icon={<Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />}
        items={recent}
        count={sections.recent.length}
        now={now}
        listId={recentListId}
        footer={
          sections.recent.length > RECENT_PREVIEW_COUNT && (
            <li>
              <button
                type="button"
                aria-expanded={showAllRecent}
                aria-controls={recentListId}
                onClick={() => setShowAllRecent((current) => !current)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground max-md:min-h-11"
              >
                {showAllRecent ? (
                  <ChevronUp aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                )}
                <span>{showAllRecent ? "Show less" : `Show ${hiddenRecent} more`}</span>
              </button>
            </li>
          )
        }
      />
    </div>
  );
}

function StatusSection({
  label,
  icon,
  items,
  count = items.length,
  now,
  action,
  footer,
  listId,
}: {
  label: string;
  icon: React.ReactNode;
  items: AgentAttentionItem[];
  count?: number;
  now: number;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  listId?: string;
}) {
  if (count === 0) return null;
  return (
    <section aria-label={label} className="group/section">
      <div className="mt-2 mb-0.5 flex min-h-6 items-center gap-1.5 px-2">
        <span className="flex w-3.5 shrink-0 justify-center">{icon}</span>
        <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
        <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>
        {action && (
          <span className="ml-auto opacity-0 motion-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100 [@media(hover:none)]:opacity-100">
            {action}
          </span>
        )}
      </div>
      <ul id={listId} className="flex flex-col gap-0.5">
        {items.map((entry) => (
          <AgentSessionRow
            key={entry.item.session.id}
            entry={entry}
            now={now}
            context="all"
          />
        ))}
        {footer}
      </ul>
    </section>
  );
}
