"use client";

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  GitBranch,
  GripVertical,
  Loader2,
  Plus,
  Wifi,
  Trash2,
} from "lucide-react";
import type {
  AgentConnectionListItem,
  AgentProviderId,
  AgentWorkspaceGitStatus,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  AGENT_SESSION_PREVIEW_COUNT,
  agentSessionDisplayTitle,
  agentSessionIsRunning,
  visibleAgentSessions,
} from "@/lib/agents/sidebar";
import {
  agentConnectionTarget,
  groupAgentWorkspaces,
  projectAgentWorkspaceProviders,
  type AgentWorkspaceGroup,
  type AgentWorkspaceSession,
} from "@/lib/agents/workspaces";
import { useSidebar } from "@/components/sidebar-context";
import { motionClasses } from "@/lib/motion";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import {
  useAgentProviderSnapshot,
  useDeleteAgentWorkspaceGroup,
} from "@/lib/queries/agentConnections";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useAgentWorkspaceGitStatus } from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { NewAgentSessionDialog } from "@/components/agents/NewAgentSessionDialog";
import { authClient } from "@/lib/auth/client";
import { getApiOrigin } from "@/lib/api-url";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  agentWorkspaceOrderStorageKey,
  orderAgentWorkspaces,
} from "@/lib/agents/workspaceOrder";

const DEFAULT_WORKSPACE_ORDER: string[] = [];

export function SidebarAgentWorkspaces({
  connections,
  providerFilter,
  organizing,
}: {
  connections: AgentConnectionListItem[];
  providerFilter: AgentProviderId | null;
  organizing: boolean;
}) {
  const { data: session } = authClient.useSession();
  const { drawerRef } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const removal = useDeleteAgentWorkspaceGroup();
  const [pendingRemoval, setPendingRemoval] =
    useState<AgentWorkspaceGroup | null>(null);
  const [removalError, setRemovalError] = useState("");

  async function confirmRemoval() {
    if (!pendingRemoval || removal.isPending) return;
    setRemovalError("");
    try {
      await removal.mutateAsync(pendingRemoval);
      const activeSessionRemoved = pendingRemoval.sessions.some(
        ({ session }) => location.pathname === `/agents/${session.id}`,
      );
      const newWorkspaceId = new URLSearchParams(location.searchStr).get(
        "workspaceId",
      );
      if (
        activeSessionRemoved ||
        (location.pathname === "/agents/new" &&
          pendingRemoval.targets.some(
            ({ workspace }) => workspace.id === newWorkspaceId,
          ))
      ) {
        void navigate({ to: "/" });
      }
      toast.success({
        title: "Workspace removed",
        description: pendingRemoval.name,
      });
      setPendingRemoval(null);
    } catch (error) {
      setRemovalError(
        error instanceof Error
          ? error.message
          : "The workspace could not be removed.",
      );
    }
  }

  const [savedOrder, setSavedOrder] = useLocalStorage<unknown>(
    agentWorkspaceOrderStorageKey(session?.user.id ?? "", getApiOrigin()),
    DEFAULT_WORKSPACE_ORDER,
  );
  const orderedGroups = useMemo(
    () => orderAgentWorkspaces(groupAgentWorkspaces(connections), savedOrder),
    [connections, savedOrder],
  );
  // Keep refetches from replacing sortable nodes while dnd-kit moves their DOM.
  const [dragGroups, setDragGroups] = useState<AgentWorkspaceGroup[] | null>(
    null,
  );
  const groups = dragGroups ?? orderedGroups;
  return (
    <>
      <DragDropProvider
        onDragStart={() => setDragGroups(orderedGroups)}
        onDragEnd={(event) => {
          if (!event.canceled) {
            setSavedOrder(
              move(
                groups.map((group) => group.key),
                event,
              ),
            );
          }
          setDragGroups(null);
        }}
      >
        <ul aria-label="Agent workspaces" className="flex flex-col gap-0.5">
          {groups.map((group, index) => (
            <WorkspaceNode
              key={group.key}
              group={group}
              index={index}
              sortable={organizing && groups.length > 1 && Boolean(session)}
              organizing={organizing}
              onRemove={() => {
                setRemovalError("");
                setPendingRemoval(group);
              }}
              providerFilter={providerFilter}
            />
          ))}
        </ul>
      </DragDropProvider>
      <AlertDialog.Root
        open={pendingRemoval !== null}
        onOpenChange={(next) => {
          if (!next && !removal.isPending) {
            setPendingRemoval(null);
            setRemovalError("");
          }
        }}
      >
        <AlertDialog.Portal container={drawerRef}>
          <AlertDialog.Backdrop
            className={cn(
              "fixed inset-0 z-50 bg-black/40",
              motionClasses.overlay,
            )}
          />
          <AlertDialog.Popup
            className={cn(
              "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-5 text-card-foreground shadow-lg outline-none",
              motionClasses.dialog,
            )}
          >
            <AlertDialog.Title className="text-base font-semibold tracking-tight">
              Remove workspace?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {pendingRemoval?.name}
              </span>{" "}
              and its agent chats will be removed from OvertChat. Files and
              native agent sessions remain on the host.
            </AlertDialog.Description>
            {removalError && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {removalError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removal.isPending}
                  />
                }
              >
                Cancel
              </AlertDialog.Close>
              <Button
                variant="destructive"
                size="sm"
                disabled={removal.isPending}
                onClick={() => void confirmRemoval()}
              >
                {removal.isPending ? "Removing…" : "Remove"}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}

function WorkspaceNode({
  group,
  index,
  sortable,
  organizing,
  onRemove,
  providerFilter,
}: {
  group: AgentWorkspaceGroup;
  index: number;
  sortable: boolean;
  organizing: boolean;
  onRemove: () => void;
  providerFilter: AgentProviderId | null;
}) {
  const { ref, handleRef, isDragSource, isDropping } = useSortable({
    id: group.key,
    index,
    disabled: !sortable,
  });
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { closeMobile } = useSidebar();
  const [createOpen, setCreateOpen] = useState(false);
  const hasActiveSession = group.sessions.some(
    ({ session }) => pathname === `/agents/${session.id}`,
  );
  const [open, setOpen] = useState(hasActiveSession);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const hasRunningSession = group.sessions.some(({ session }) =>
    agentSessionIsRunning(session),
  );
  const representativeTarget = group.targets[0]!;
  const representativeWorkspace = representativeTarget.workspace;
  const providerSnapshot = useAgentProviderSnapshot(
    agentConnectionTarget(representativeTarget.connection),
  );
  const gitStatus = useAgentWorkspaceGitStatus(representativeWorkspace.id, {
    enabled: open || hasActiveSession,
    active: hasActiveSession,
    running: hasRunningSession,
  }).data;
  const activeSessionId =
    group.sessions.find(({ session }) => pathname === `/agents/${session.id}`)
      ?.session.id ?? null;
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
  const sessionTargets = projectAgentWorkspaceProviders(
    group,
    providerSnapshot.data,
  ).map(({ provider, workspace }) => {
    return {
      workspace,
      provider,
      providerLabel: agentProviderMetadata(provider).label,
    };
  });

  function startNewSession() {
    const target = sessionTargets[0];
    if (sessionTargets.length !== 1 || !target) {
      setCreateOpen(true);
      return;
    }
    setOpen(true);
    closeMobile();
    void navigate({
      to: "/agents/new",
      search: { workspaceId: target.workspace.id, provider: target.provider },
    });
  }

  return (
    <li
      ref={ref}
      data-dropping={isDropping}
      className={cn(
        (isDragSource || isDropping) &&
          "relative z-10 rounded-md bg-sidebar shadow-md",
      )}
    >
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
        {organizing ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${group.name}`}
            title={`Remove ${group.name}`}
            className="flex min-h-11 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground motion-colors hover:bg-destructive/10 hover:text-destructive max-md:w-11"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={startNewSession}
            disabled={sessionTargets.length === 0}
            aria-label={`New session in ${group.name}`}
            title={
              sessionTargets.length > 0
                ? `New session in ${group.name}`
                : "No agents are currently available on this machine"
            }
            className={cn(
              "flex min-h-11 w-9 shrink-0 items-center justify-center rounded-r-md text-muted-foreground motion-colors hover:text-foreground focus-visible:text-foreground max-md:w-11",
              motionClasses.hoverReveal,
            )}
          >
            <Plus className="size-4" />
          </button>
        )}
        <button
          ref={handleRef}
          type="button"
          disabled={!sortable}
          aria-label={`Reorder ${group.name}`}
          title="Drag to reorder"
          className={cn(
            "flex min-h-11 w-9 shrink-0 touch-none cursor-grab items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40 max-md:w-11",
            !organizing && "hidden",
          )}
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      {open && (
        <ul className="flex flex-col gap-0.5 pl-7">
          {visibleSessions.map((item) => (
            <SessionLink key={item.session.id} item={item} />
          ))}
          {filteredSessions.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No{" "}
              {providerFilter
                ? agentProviderMetadata(providerFilter).label
                : "agent"}{" "}
              chats
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
      {sessionTargets.length > 1 && (
        <NewAgentSessionDialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) setOpen(true);
          }}
          targets={sessionTargets}
          machineLabel={
            group.host.transport === "local"
              ? "This server"
              : `ssh ${group.host.sshAlias}`
          }
        />
      )}
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
  const pathname = useLocation({ select: (location) => location.pathname });
  const { closeMobile } = useSidebar();
  const { session, provider } = item;
  const title = agentSessionDisplayTitle(session) || "New session";
  return (
    <li>
      <Link
        to="/agents/$id"
        params={{ id: session.id }}
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
  const icon = AGENT_PROVIDER_VISUALS[provider];
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-sm opacity-80",
        icon.darkSurface && "bg-zinc-950/90",
      )}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon.icon} alt="" className="size-2.5 object-contain" />
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
