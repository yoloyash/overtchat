"use client";

import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileDiff,
  GitBranch,
  GripVertical,
  Loader2,
  Monitor,
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
const DEFAULT_EXPANSION: Record<string, boolean> = {};
const RECENT_CHAT_COUNT = 5;

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
  const [savedExpansion, setSavedExpansion] = useLocalStorage<unknown>(
    `overtchat_agent_workspace_expansion:${JSON.stringify([getApiOrigin(), session?.user.id ?? ""])}`,
    DEFAULT_EXPANSION,
  );
  const expansion =
    savedExpansion &&
    typeof savedExpansion === "object" &&
    !Array.isArray(savedExpansion)
      ? (savedExpansion as Record<string, unknown>)
      : DEFAULT_EXPANSION;
  function setExpanded(key: string, open: boolean) {
    setSavedExpansion({ ...expansion, [key]: open });
  }
  const [recentCollapsed, setRecentCollapsed] = useLocalStorage<unknown>(
    `overtchat_agent_recent_collapsed:${JSON.stringify([getApiOrigin(), session?.user.id ?? ""])}`,
    false,
  );
  const recentListId = useId();
  const orderedGroups = useMemo(
    () => orderAgentWorkspaces(groupAgentWorkspaces(connections), savedOrder),
    [connections, savedOrder],
  );
  const revealedChatRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.user.id) return;
    const activeGroup = orderedGroups.find((group) =>
      group.sessions.some(
        ({ session }) => location.pathname === `/agents/${session.id}`,
      ),
    );
    if (!activeGroup) {
      revealedChatRef.current = null;
      return;
    }
    const revealKey = JSON.stringify([
      session.user.id,
      location.pathname,
      activeGroup.key,
    ]);
    // Reveal on navigation or initial discovery, without undoing a later
    // manual collapse when the connection list refetches.
    if (revealedChatRef.current === revealKey) return;
    revealedChatRef.current = revealKey;
    if (expansion[activeGroup.key] !== true) {
      setSavedExpansion({ ...expansion, [activeGroup.key]: true });
    }
  }, [
    location.pathname,
    orderedGroups,
    session?.user.id,
    expansion,
    setSavedExpansion,
  ]);
  // Keep refetches from replacing sortable nodes while dnd-kit moves their DOM.
  const [dragGroups, setDragGroups] = useState<AgentWorkspaceGroup[] | null>(
    null,
  );
  const groups = dragGroups ?? orderedGroups;
  const recentSessions = useMemo(
    () =>
      orderedGroups
        .flatMap((group) =>
          group.sessions
            .filter(
              (item) => !providerFilter || item.provider === providerFilter,
            )
            .map((item) => ({ item, group })),
        )
        .sort(
          (left, right) =>
            (right.item.session.modifiedAt ??
              right.item.session.createdAt ??
              0) -
            (left.item.session.modifiedAt ?? left.item.session.createdAt ?? 0),
        )
        .slice(0, RECENT_CHAT_COUNT),
    [orderedGroups, providerFilter],
  );
  return (
    <>
      {recentSessions.length > 0 && !organizing && (
        <div className="mb-2 border-b border-sidebar-border pb-2">
          <button
            type="button"
            aria-expanded={recentCollapsed !== true}
            aria-controls={recentListId}
            title="Most recently updated chats across your workspaces"
            onClick={() => setRecentCollapsed(recentCollapsed !== true)}
            className="flex min-h-7 w-full items-center gap-1.5 rounded-md px-1 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground max-md:min-h-11"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3 shrink-0 motion-transform",
                recentCollapsed !== true && "rotate-90",
              )}
            />
            <span>Recent chats</span>
          </button>
          <ul
            id={recentListId}
            aria-label="Recent agent chats"
            hidden={recentCollapsed === true}
            className={cn(
              "flex-col gap-0.5",
              recentCollapsed === true ? "hidden" : "flex",
            )}
          >
            {recentSessions.map(({ item, group }) => (
              <SessionLink
                key={item.session.id}
                item={item}
                context={`${group.name} · ${workspaceHostLabel(group)}`}
                onNavigate={() => setExpanded(group.key, true)}
              />
            ))}
          </ul>
        </div>
      )}
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
              expanded={
                typeof expansion[group.key] === "boolean"
                  ? (expansion[group.key] as boolean)
                  : undefined
              }
              onExpandedChange={(next) => setExpanded(group.key, next)}
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
  expanded,
  onExpandedChange,
  onRemove,
  providerFilter,
}: {
  group: AgentWorkspaceGroup;
  index: number;
  sortable: boolean;
  organizing: boolean;
  expanded: boolean | undefined;
  onExpandedChange: (open: boolean) => void;
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
  const open = expanded ?? hasActiveSession;
  const sessionListId = useId();
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
    active: hasActiveSession,
    running: hasRunningSession,
  }).data;
  const activeSessionId =
    group.sessions.find(({ session }) => pathname === `/agents/${session.id}`)
      ?.session.id ?? null;
  const filteredSessions = providerFilter
    ? group.sessions.filter(({ provider }) => provider === providerFilter)
    : group.sessions;
  const runningCount = filteredSessions.filter(({ session }) =>
    agentSessionIsRunning(session),
  ).length;
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
    onExpandedChange(true);
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
      <div
        className={cn(
          "group relative flex min-w-0 rounded-md motion-colors hover:bg-sidebar-accent",
          hasActiveSession && "bg-sidebar-accent/60",
        )}
      >
        <button
          type="button"
          onClick={() => onExpandedChange(!open)}
          aria-label={open ? `Collapse ${group.name}` : `Expand ${group.name}`}
          aria-expanded={open}
          aria-controls={sessionListId}
          className={cn(
            "flex min-h-10 min-w-0 flex-1 items-start gap-1.5 rounded-md px-1 py-0.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
            organizing ? "pr-0" : "pr-7 max-md:pr-11",
          )}
          title={`${group.path} · ${workspaceHostLabel(group)}`}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              "mt-1 size-3 shrink-0 text-muted-foreground motion-transform",
              open && "rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate font-medium leading-5">
                {group.name}
              </span>
              {runningCount > 0 && (
                <span
                  role="status"
                  aria-label={`${runningCount} running ${runningCount === 1 ? "chat" : "chats"} in ${group.name}`}
                  className="flex shrink-0 items-center gap-1 text-[10px] text-primary"
                >
                  <Loader2
                    aria-hidden="true"
                    className={cn("size-3", motionClasses.spinner)}
                  />
                  <span className="tabular-nums">{runningCount}</span>
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] leading-3 text-muted-foreground">
              <span
                className={cn(
                  "flex min-w-0 items-center gap-1",
                  gitStatus?.isGit && "max-w-[45%]",
                )}
                title={workspaceHostLabel(group)}
              >
                {group.host.transport === "ssh" ? (
                  <Wifi aria-hidden="true" className="size-2.5 shrink-0" />
                ) : (
                  <Monitor aria-hidden="true" className="size-2.5 shrink-0" />
                )}
                <span className="truncate">{workspaceHostLabel(group)}</span>
              </span>
              {gitStatus?.isGit && (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  ·
                </span>
              )}
              <WorkspaceGitMeta
                status={gitStatus}
                workspaceId={representativeWorkspace.id}
              />
            </span>
          </span>
        </button>
        {organizing ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${group.name}`}
            title={`Remove ${group.name}`}
            className="flex min-h-10 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground motion-colors hover:bg-destructive/10 hover:text-destructive max-md:min-h-11 max-md:w-11"
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
              "absolute inset-y-0 right-0 flex w-7 items-center justify-center rounded-r-md text-muted-foreground motion-colors hover:text-foreground focus-visible:text-foreground max-md:w-11",
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
            "flex min-h-10 w-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:cursor-default disabled:opacity-40 max-md:min-h-11 max-md:w-11",
            !organizing && "hidden",
          )}
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <ul
        id={sessionListId}
        hidden={!open}
        className={cn(
          "ml-2.5 flex-col gap-0.5 border-l border-sidebar-border pl-1.5",
          open ? "flex" : "hidden",
        )}
      >
        {open && (
          <>
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
          </>
        )}
      </ul>
      {sessionTargets.length > 1 && (
        <NewAgentSessionDialog
          open={createOpen}
          onOpenChange={(next) => {
            setCreateOpen(next);
            if (!next) onExpandedChange(true);
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
      className="flex min-w-0 flex-1 items-center gap-1 text-[10px]"
      title={detail}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <GitBranch aria-hidden="true" className="size-2.5 shrink-0" />
        <span className="truncate">{status.branch ?? "Detached HEAD"}</span>
      </span>
      {status.dirty && (
        <span
          className="flex shrink-0 items-center gap-0.5 tabular-nums text-amber-500"
          aria-label={`${status.changedFiles} changed file${status.changedFiles === 1 ? "" : "s"}`}
        >
          <FileDiff aria-hidden="true" className="size-2.5" />
          {status.changedFiles}
        </span>
      )}
    </span>
  );
}

function workspaceHostLabel(group: AgentWorkspaceGroup) {
  return group.host.sshAlias || group.host.name || "This server";
}

function SessionLink({
  item,
  context,
  onNavigate,
}: {
  item: AgentWorkspaceSession;
  context?: string;
  onNavigate?: () => void;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { closeMobile } = useSidebar();
  const { session, provider } = item;
  const title = agentSessionDisplayTitle(session) || "New session";
  return (
    <li>
      <Link
        to="/agents/$id"
        params={{ id: session.id }}
        onClick={() => {
          onNavigate?.();
          closeMobile();
        }}
        aria-current={pathname === `/agents/${session.id}` ? "page" : undefined}
        title={`${title} · ${agentProviderMetadata(provider).label}${context ? ` · ${context}` : ""}`}
        className={cn(
          "flex min-h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground outline-none motion-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
          context && "min-h-10",
          pathname === `/agents/${session.id}` &&
            "bg-sidebar-accent text-foreground",
        )}
      >
        <ProviderLogo provider={provider} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate leading-4",
              context && "text-sidebar-foreground",
            )}
          >
            {title}
          </span>
          {context && (
            <span className="block truncate text-[10px] leading-3 text-muted-foreground">
              {context}
            </span>
          )}
        </span>
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
    // Keep a stable slot for working, attention, and other future chat states.
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
