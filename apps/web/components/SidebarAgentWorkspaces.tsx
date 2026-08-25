"use client";

import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  GitBranch,
  Loader2,
  Plus,
  Wifi,
} from "lucide-react";
import codexIcon from "@/assets/agent-providers/codex.png";
import ompIcon from "@/assets/agent-providers/omp.svg";
import piIcon from "@/assets/agent-providers/pi.svg";
import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  agentSessionIsRunning,
  visibleAgentSessions,
} from "@/lib/agents/sidebar";
import {
  groupAgentWorkspaces,
  type AgentWorkspaceGroup,
  type AgentWorkspaceSession,
} from "@/lib/agents/workspaces";
import { useSidebar } from "@/components/sidebar-context";
import { motionClasses } from "@/lib/motion";
import { useAgentWorkspaceGitStatus } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { NewAgentSessionDialog } from "@/components/agents/NewAgentSessionDialog";

const PROVIDER_ICONS: Record<
  AgentProviderId,
  { icon: StaticImageData; darkSurface?: boolean }
> = {
  pi: { icon: piIcon },
  omp: { icon: ompIcon, darkSurface: true },
  codex: { icon: codexIcon, darkSurface: true },
};

export function SidebarAgentWorkspaces({
  connections,
  providerFilter,
}: {
  connections: AgentConnectionListItem[];
  providerFilter: AgentProviderId | null;
}) {
  const groups = useMemo(() => groupAgentWorkspaces(connections), [connections]);
  if (groups.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {groups.map((group) => (
        <WorkspaceNode
          key={group.key}
          group={group}
          providerFilter={providerFilter}
        />
      ))}
    </ul>
  );
}

function WorkspaceNode({
  group,
  providerFilter,
}: {
  group: AgentWorkspaceGroup;
  providerFilter: AgentProviderId | null;
}) {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const hasActiveSession = group.sessions.some(
    ({ session }) => pathname === `/agents/${session.id}`,
  );
  const [open, setOpen] = useState(hasActiveSession);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const hasRunningSession = group.sessions.some(({ session }) =>
    agentSessionIsRunning(session),
  );
  const representativeWorkspace = group.targets[0]!.workspace;
  const gitStatus = useAgentWorkspaceGitStatus(representativeWorkspace.id, {
    active: hasActiveSession,
    running: hasRunningSession,
  }).data;
  const activeSessionId =
    group.sessions.find(
      ({ session }) => pathname === `/agents/${session.id}`,
    )?.session.id ?? null;
  const filteredSessions = providerFilter
    ? group.sessions.filter(({ provider }) => provider === providerFilter)
    : group.sessions;
  const visibleSessionItems = visibleAgentSessions(
    filteredSessions.map(({ session }) => session),
    sessionsExpanded,
    activeSessionId,
  );
  const visibleIds = new Set(visibleSessionItems.map((session) => session.id));
  const visibleSessions = filteredSessions.filter(({ session }) =>
    visibleIds.has(session.id),
  );
  const hiddenSessionCount = filteredSessions.length - visibleSessions.length;

  return (
    <li>
      <div className="group flex min-w-0 rounded-md motion-colors hover:bg-sidebar-accent">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={open ? `Collapse ${group.name}` : `Expand ${group.name}`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-l-md px-1 py-1 text-left text-sm"
          title={group.path}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground motion-transform",
              open && "rotate-90",
            )}
          />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-h-8 min-w-0 flex-1 flex-col justify-center">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate">{group.name}</span>
              {!open && hasRunningSession && (
                <RuntimeActivityIndicator
                  active
                  label={`${group.name} has running sessions`}
                />
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
              {group.host.transport === "ssh" && (
                <span className="flex min-w-0 items-center gap-1">
                  <Wifi className="size-3 shrink-0" />
                  <span className="max-w-20 truncate">
                    {group.host.sshAlias ?? group.host.name}
                  </span>
                </span>
              )}
              <WorkspaceGitMeta status={gitStatus} workspaceId={representativeWorkspace.id} />
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label={`New session in ${group.name}`}
          title={`New session in ${group.name}`}
          className={cn(
            "flex min-h-11 w-9 shrink-0 items-center justify-center rounded-r-md text-muted-foreground motion-colors hover:text-foreground focus-visible:text-foreground max-md:w-11",
            motionClasses.hoverReveal,
          )}
        >
          <Plus className="size-4" />
        </button>
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 pl-7">
          {visibleSessions.map((item) => (
            <SessionLink key={item.session.id} item={item} />
          ))}
          {filteredSessions.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No {providerFilter ? agentProviderMetadata(providerFilter).label : "agent"} chats
            </li>
          )}
          {filteredSessions.length > AGENT_SESSION_PREVIEW_COUNT &&
            (sessionsExpanded || hiddenSessionCount > 0) && (
              <li>
                <button
                  type="button"
                  onClick={() => setSessionsExpanded((current) => !current)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
                >
                  {sessionsExpanded ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  <span>
                    {sessionsExpanded
                      ? "Show less"
                      : `Show ${hiddenSessionCount} more`}
                  </span>
                </button>
              </li>
            )}
        </ul>
      )}
      <NewAgentSessionDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          if (!next) setOpen(true);
        }}
        targets={group.targets.map(({ connection, workspace }) => ({
          workspace,
          provider: connection.provider,
          providerLabel: agentProviderMetadata(connection.provider).label,
        }))}
        machineLabel={
          group.host.transport === "local"
            ? "This server"
            : `ssh ${group.host.sshAlias}`
        }
      />
    </li>
  );
}

function WorkspaceGitMeta({
  status,
  workspaceId,
}: {
  status: AgentWorkspaceGitStatus | undefined;
  workspaceId: string;
}) {
  if (!status?.isGit) return null;
  const detail = [
    status.branch ?? "Detached HEAD",
    status.dirty
      ? `${status.changedFiles} changed file${status.changedFiles === 1 ? "" : "s"}`
      : "Clean",
    status.lineStatsComplete && status.dirty
      ? `+${status.additions} −${status.deletions}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      data-testid={`sidebar-workspace-git-status-${workspaceId}`}
      className="flex min-w-0 flex-1 items-center gap-1 text-[10px] tracking-tight"
      title={detail}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <GitBranch className="size-3 shrink-0" />
        <span className="truncate">
          {status.branch ?? "Detached HEAD"}
        </span>
      </span>
      {status.dirty && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-amber-500"
          aria-label={`${status.changedFiles} changed file${status.changedFiles === 1 ? "" : "s"}`}
        />
      )}
    </span>
  );
}

function SessionLink({ item }: { item: AgentWorkspaceSession }) {
  const pathname = usePathname();
  const { closeMobile } = useSidebar();
  const { session, provider } = item;
  const title = session.name || session.firstMessage || "Untitled session";
  return (
    <li>
      <Link
        href={`/agents/${session.id}`}
        onClick={closeMobile}
        title={`${title} · ${agentProviderMetadata(provider).label}`}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground",
          pathname === `/agents/${session.id}` &&
            "bg-sidebar-accent text-foreground",
        )}
      >
        <ProviderLogo provider={provider} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <RuntimeActivityIndicator
          active={agentSessionIsRunning(session)}
          label={`${title} is working`}
        />
      </Link>
    </li>
  );
}

function ProviderLogo({ provider }: { provider: AgentProviderId }) {
  const icon = PROVIDER_ICONS[provider];
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-sm opacity-80",
        icon.darkSurface && "bg-zinc-950/90",
      )}
      aria-hidden="true"
    >
      <Image src={icon.icon} alt="" className="size-2.5 object-contain" />
    </span>
  );
}

function RuntimeActivityIndicator({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {active && (
        <span
          role="status"
          aria-label={label}
          className="flex size-4 items-center justify-center text-muted-foreground"
        >
          <Loader2
            aria-hidden="true"
            className={cn("size-3.5", motionClasses.spinner)}
          />
        </span>
      )}
    </span>
  );
}
