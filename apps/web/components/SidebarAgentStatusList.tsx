"use client";

import { useId, useMemo, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type {
  AgentConnectionListItem,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import { AgentSessionStatusIcon } from "@/components/agents/AgentSessionStatus";
import {
  AgentSessionListToggle,
  AgentSessionRow,
} from "@/components/agents/AgentSessionRow";
import {
  agentAttentionSections,
  type AgentAttentionItem,
  type AgentAttentionSections,
} from "@/lib/agents/attention";
import { AGENT_SESSION_PREVIEW_COUNT } from "@/lib/agents/sidebar";
import { groupAgentWorkspaces } from "@/lib/agents/workspaces";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

const COLLAPSED_GROUPS_KEY = "overtchat:agent-status-collapsed";
const NO_COLLAPSED_GROUPS: string[] = [];

type StatusGroupKey = keyof AgentAttentionSections;

const STATUS_GROUPS: {
  key: StatusGroupKey;
  label: string;
  icon: React.ReactNode;
}[] = [
  // Each header wears the mark its rows do.
  { key: "needsInput", label: "Needs input", icon: <AgentSessionStatusIcon state="approval" /> },
  { key: "failed", label: "Failed", icon: <AgentSessionStatusIcon state="failed" /> },
  { key: "ready", label: "Ready to review", icon: <AgentSessionStatusIcon state="unread" /> },
  { key: "working", label: "Working", icon: <AgentSessionStatusIcon state="working" /> },
  { key: "done", label: "Done", icon: <AgentSessionStatusIcon state="idle" /> },
];

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
  const [storedCollapsed, setStoredCollapsed] = useLocalStorage<unknown>(
    COLLAPSED_GROUPS_KEY,
    NO_COLLAPSED_GROUPS,
  );
  const collapsed = Array.isArray(storedCollapsed) ? storedCollapsed : NO_COLLAPSED_GROUPS;
  const [showAllDone, setShowAllDone] = useState(false);
  const doneListId = useId();
  // Running times tick each second; ages only need the minute.
  const now = useNow(sections.working.length > 0 ? 1_000 : 30_000);
  const pathname = useLocation({ select: (location) => location.pathname });
  // Only Done is shortened, and the open session stays listed when it is older.
  const done = showAllDone
    ? sections.done
    : sections.done.filter(
        ({ item }, index) =>
          index < AGENT_SESSION_PREVIEW_COUNT ||
          pathname === `/agents/${item.session.id}`,
      );

  if (Object.values(sections).every((items) => items.length === 0)) {
    return (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        No sessions yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 pb-1">
      {STATUS_GROUPS.map(({ key, label, icon }) =>
        sections[key].length === 0 ? null : (
          <StatusGroup
            key={key}
            label={label}
            icon={icon}
            items={key === "done" ? done : sections[key]}
            now={now}
            collapsed={collapsed.includes(key)}
            onToggle={() =>
              setStoredCollapsed(
                collapsed.includes(key)
                  ? collapsed.filter((item) => item !== key)
                  : [...collapsed, key],
              )
            }
            listId={key === "done" ? doneListId : undefined}
            footer={
              key === "done" &&
              sections.done.length > AGENT_SESSION_PREVIEW_COUNT && (
                <AgentSessionListToggle
                  expanded={showAllDone}
                  hiddenCount={sections.done.length - done.length}
                  onToggle={() => setShowAllDone((current) => !current)}
                  controls={doneListId}
                />
              )
            }
          />
        ),
      )}
    </div>
  );
}

function StatusGroup({
  label,
  icon,
  items,
  now,
  collapsed,
  onToggle,
  footer,
  listId,
}: {
  label: string;
  icon: React.ReactNode;
  items: AgentAttentionItem[];
  now: number;
  collapsed: boolean;
  onToggle: () => void;
  footer?: React.ReactNode;
  listId?: string;
}) {
  const fallbackListId = useId();
  const id = listId ?? fallbackListId;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <section aria-label={label}>
      <h2>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={id}
          onClick={onToggle}
          className="group/header flex min-h-8 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground outline-none motion-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
        >
          {/* The group's mark turns into its chevron while pointed at. */}
          <span className="flex w-3.5 shrink-0 justify-center">
            <span className="flex group-hover/header:hidden group-focus-visible/header:hidden">
              {icon}
            </span>
            <Chevron
              aria-hidden="true"
              className="hidden size-3.5 group-hover/header:block group-focus-visible/header:block"
            />
          </span>
          <span className="truncate">{label}</span>
        </button>
      </h2>
      <ul id={id} hidden={collapsed} className={cn("mt-0.5 flex-col gap-0.5", collapsed ? "hidden" : "flex")}>
        {!collapsed && (
          <>
            {items.map((entry) => (
              <AgentSessionRow
                key={entry.item.session.id}
                entry={entry}
                now={now}
                context="all"
              />
            ))}
            {footer}
          </>
        )}
      </ul>
    </section>
  );
}
