"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDiff,
  Folder,
  GitBranch,
  Loader2,
  Plus,
  TerminalSquare,
} from "lucide-react";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
  AgentWorkspaceGitStatus,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  agentConnectionHasRunningSession,
  agentSessionIsRunning,
  agentWorkspaceHasRunningSession,
  visibleAgentSessions,
} from "@/lib/agents/sidebar";
import { useSidebar } from "@/components/sidebar-context";
import { motionClasses } from "@/lib/motion";
import { useAgentWorkspaceGitStatus } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { NewAgentSessionDialog } from "@/components/agents/NewAgentSessionDialog";

export function SidebarConnections({
  connections,
}: {
  connections: AgentConnectionListItem[];
}) {
  if (connections.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {connections.map((connection) => (
        <ConnectionNode key={connection.id} connection={connection} />
      ))}
    </ul>
  );
}

function ConnectionNode({
  connection,
}: {
  connection: AgentConnectionListItem;
}) {
  const provider = agentProviderMetadata(connection.provider);
  const pathname = usePathname();
  const hasActiveSession = connection.workspaces.some((workspace) =>
    workspace.sessions.some(
      (session) => pathname === `/agents/${session.id}`,
    ),
  );
  const [open, setOpen] = useState(hasActiveSession);
  const hasRunningSession = agentConnectionHasRunningSession(connection);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={
          open
            ? `Collapse ${connection.host.name}`
            : `Expand ${connection.host.name}`
        }
        className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-sm motion-colors hover:bg-sidebar-accent"
        title={`${connection.host.name} · ${provider.label}`}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground motion-transform",
            open && "rotate-90",
          )}
        />
        <TerminalSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{connection.host.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {provider.label}
        </span>
        <RuntimeActivityIndicator
          active={!open && hasRunningSession}
          label={`${connection.host.name} has running sessions`}
        />
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 pl-3">
          {connection.workspaces.map((workspace) => (
            <WorkspaceNode
              key={workspace.id}
              workspace={workspace}
              provider={connection.provider}
              providerLabel={provider.label}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function WorkspaceNode({
  workspace,
  provider,
  providerLabel,
}: {
  workspace: AgentWorkspaceListItem;
  provider: AgentConnectionListItem["provider"];
  providerLabel: string;
}) {
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const hasActiveSession = workspace.sessions.some(
    (session) => pathname === `/agents/${session.id}`,
  );
  const [open, setOpen] = useState(hasActiveSession);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const hasRunningSession = agentWorkspaceHasRunningSession(workspace);
  const gitStatus = useAgentWorkspaceGitStatus(workspace.id, {
    active: hasActiveSession,
    running: hasRunningSession,
  }).data;
  const activeSessionId =
    workspace.sessions.find(
      (session) => pathname === `/agents/${session.id}`,
    )?.id ?? null;
  const visibleSessions = visibleAgentSessions(
    workspace.sessions,
    sessionsExpanded,
    activeSessionId,
  );
  const hiddenSessionCount =
    workspace.sessions.length - visibleSessions.length;

  return (
    <li>
      <div className="group flex min-w-0 items-center">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={
            open
              ? `Collapse ${workspace.name}`
              : `Expand ${workspace.name}`
          }
          className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm motion-colors hover:bg-sidebar-accent"
          title={workspace.path}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground motion-transform",
              open && "rotate-90",
            )}
          />
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="flex min-h-8 min-w-0 flex-1 flex-col justify-center">
            <span className="truncate">{workspace.name}</span>
            <WorkspaceGitMeta status={gitStatus} workspaceId={workspace.id} />
          </span>
          <RuntimeActivityIndicator
            active={!open && hasRunningSession}
            label={`${workspace.name} has running sessions`}
          />
        </button>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label={`New session in ${workspace.name}`}
          title={`New session in ${workspace.name}`}
          className="mr-0.5 rounded p-1 text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 max-md:p-2"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 pl-7">
          {visibleSessions.map((session) => (
            <SessionLink key={session.id} session={session} />
          ))}
          {workspace.sessions.length > AGENT_SESSION_PREVIEW_COUNT &&
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
        workspace={workspace}
        provider={provider}
        providerLabel={providerLabel}
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
  return (
    <span
      data-testid={`sidebar-workspace-git-status-${workspaceId}`}
      className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground"
    >
      <span className="flex min-w-0 items-center gap-1">
        <GitBranch className="size-3 shrink-0" />
        <span className="max-w-24 truncate">
          {status.branch ?? "Detached HEAD"}
        </span>
      </span>
      {status.dirty && (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
          <FileDiff className="size-3" />
          <span>{status.changedFiles}</span>
          {status.lineStatsComplete && (
            <>
              <span className="text-emerald-700 dark:text-emerald-300">
                +{status.additions}
              </span>
              <span className="text-red-700 dark:text-red-300">
                -{status.deletions}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}

function SessionLink({ session }: { session: AgentSessionListItem }) {
  const pathname = usePathname();
  const { closeMobile } = useSidebar();
  const title = session.name || session.firstMessage || "Untitled session";
  return (
    <li>
      <Link
        href={`/agents/${session.id}`}
        onClick={closeMobile}
        title={title}
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground",
          pathname === `/agents/${session.id}` &&
            "bg-sidebar-accent text-foreground",
        )}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <RuntimeActivityIndicator
          active={agentSessionIsRunning(session)}
          label={`${title} is working`}
        />
      </Link>
    </li>
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
