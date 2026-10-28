"use client";

import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ChevronRight,
  FileDiff,
  GitBranch,
  GitBranchPlus,
  GripVertical,
  Plus,
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
  agentSessionIsRunning,
  visibleAgentSessions,
} from "@/lib/agents/sidebar";
import {
  agentSessionState,
  agentSessionStateSince,
  mostUrgentAgentSessionState,
} from "@/lib/agents/attention";
import { agentWorkspaceHostLabel } from "@/lib/agents/search";
import {
  agentConnectionTarget,
  groupAgentWorkspaces,
  nestAgentWorkspaceGroups,
  projectAgentWorkspaceProviders,
  type AgentWorkspaceGroup,
} from "@/lib/agents/workspaces";
import { useSidebar } from "@/components/sidebar-context";
import { motionClasses } from "@/lib/motion";
import {
  useAgentProviderSnapshot,
  useDeleteAgentWorkspaceGroup,
} from "@/lib/queries/agentConnections";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  useAgentWorkspaceGitStatus,
  useAgentWorktreeInspection,
} from "@/lib/queries/agentWorkspaces";
import { cn } from "@/lib/utils";
import { NewAgentSessionDialog } from "@/components/agents/NewAgentSessionDialog";
import { NewAgentWorktreeDialog } from "@/components/agents/NewAgentWorktreeDialog";
import { AgentWorktreeRemovalDetails } from "@/components/agents/AgentWorktreeRemovalDetails";
import {
  AgentSessionStatusIcon,
  agentSessionStateLabel,
} from "@/components/agents/AgentSessionStatus";
import {
  AgentSessionListToggle,
  AgentSessionRow,
} from "@/components/agents/AgentSessionRow";
import { useNow } from "@/lib/useNow";
import { authClient } from "@/lib/auth/client";
import { getApiOrigin } from "@/lib/api-url";
import { useLocalStorage } from "@/lib/useLocalStorage";
import {
  agentWorkspaceOrderStorageKey,
  orderAgentWorkspaces,
} from "@/lib/agents/workspaceOrder";

const DEFAULT_WORKSPACE_ORDER: string[] = [];
const DEFAULT_EXPANSION: Record<string, boolean> = {};

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
  const pendingRemovalWorktree =
    pendingRemoval?.targets.find(
      ({ workspace }) => workspace.worktreeParentPath,
    )?.workspace ?? null;
  // Removal waits until the dialog can say what would be lost.
  const worktreeInspection = useAgentWorktreeInspection(
    pendingRemovalWorktree?.id ?? "",
  );

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
        // Stay in Agents mode; its home opens another workspace if any remain.
        void navigate({ to: "/agents" });
      }
      toast.success({
        title: pendingRemovalWorktree
          ? "Worktree removed"
          : "Workspace removed",
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
  const orderedGroups = useMemo(
    () => orderAgentWorkspaces(groupAgentWorkspaces(connections), savedOrder),
    [connections, savedOrder],
  );
  const nested = useMemo(
    () => nestAgentWorkspaceGroups(orderedGroups),
    [orderedGroups],
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
    // A worktree's workspace must be open for the worktree to show.
    const reveal = [activeGroup.key, activeGroup.parentKey].filter(
      (key): key is string => key !== null && expansion[key] !== true,
    );
    if (reveal.length > 0) {
      setSavedExpansion({
        ...expansion,
        ...Object.fromEntries(reveal.map((key) => [key, true])),
      });
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
  const groups = dragGroups ?? nested.roots;
  return (
    <>
      <DragDropProvider
        onDragStart={() => setDragGroups(nested.roots)}
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
              worktrees={nested.worktrees.get(group.key) ?? []}
              renderWorktree={(worktree, worktreeIndex) => (
                <WorkspaceNode
                  key={worktree.key}
                  group={worktree}
                  index={worktreeIndex}
                  sortGroup={group.key}
                  sortable={false}
                  organizing={organizing}
                  expanded={
                    typeof expansion[worktree.key] === "boolean"
                      ? (expansion[worktree.key] as boolean)
                      : undefined
                  }
                  onExpandedChange={(next) => setExpanded(worktree.key, next)}
                  onRemove={() => {
                    setRemovalError("");
                    setPendingRemoval(worktree);
                  }}
                  providerFilter={providerFilter}
                  worktrees={[]}
                  renderWorktree={() => null}
                />
              )}
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
              {pendingRemovalWorktree
                ? "Remove worktree?"
                : "Remove workspace?"}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">
              {pendingRemovalWorktree ? (
                <AgentWorktreeRemovalDetails
                  workspaceId={pendingRemovalWorktree.id}
                  name={pendingRemoval?.name ?? ""}
                />
              ) : (
                <>
                  <span className="font-medium text-foreground">
                    {pendingRemoval?.name}
                  </span>{" "}
                  and its agent chats will be removed from OvertChat. Files and
                  native agent sessions remain on the host.
                </>
              )}
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
                disabled={removal.isPending || worktreeInspection.isLoading}
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
  worktrees,
  renderWorktree,
  sortGroup,
}: {
  group: AgentWorkspaceGroup;
  index: number;
  sortable: boolean;
  organizing: boolean;
  expanded: boolean | undefined;
  onExpandedChange: (open: boolean) => void;
  onRemove: () => void;
  providerFilter: AgentProviderId | null;
  /** OvertChat worktrees created from this workspace. */
  worktrees: AgentWorkspaceGroup[];
  renderWorktree: (
    worktree: AgentWorkspaceGroup,
    index: number,
  ) => React.ReactNode;
  sortGroup?: string;
}) {
  const { ref, handleRef, isDragSource, isDropping } = useSortable({
    id: group.key,
    index,
    group: sortGroup,
    disabled: !sortable,
  });
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const { closeMobile } = useSidebar();
  const [createOpen, setCreateOpen] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const hasActiveSession = group.sessions.some(
    ({ session }) => pathname === `/agents/${session.id}`,
  );
  const hasActiveWorktreeSession = worktrees.some((worktree) =>
    worktree.sessions.some(
      ({ session }) => pathname === `/agents/${session.id}`,
    ),
  );
  const open = expanded ?? (hasActiveSession || hasActiveWorktreeSession);
  const sessionListId = useId();
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const hasRunningSession = group.sessions.some(({ session }) =>
    agentSessionIsRunning(session),
  );
  // Running times tick each second; ages only need the minute.
  const now = useNow(hasRunningSession ? 1_000 : 30_000);
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
  const urgentState = mostUrgentAgentSessionState(
    filteredSessions.map(({ session }) => session),
  );
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

  // Worktrees of a worktree are created from it but nest under the same workspace.
  const canCreateWorktree =
    gitStatus?.isGit === true && sessionTargets.length > 0;

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
        // An open workspace keeps a gap before the next, like a status group.
        open && "pb-2",
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
            "flex min-h-10 min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-px text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
            organizing
              ? "pr-0"
              : canCreateWorktree
                ? "pr-14 max-md:pr-[5.5rem]"
                : "pr-7 max-md:pr-11",
          )}
          title={`${group.path} · ${agentWorkspaceHostLabel(group)}`}
        >
          <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "size-3.5 text-muted-foreground motion-transform",
                open && "rotate-90",
              )}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate leading-5">
                {group.name}
              </span>
              {/* A closed workspace shows the most urgent state among its sessions. */}
              {!open && urgentState !== "idle" && (
                <span
                  role="status"
                  aria-label={`${agentSessionStateLabel(urgentState)} in ${group.name}`}
                  title={agentSessionStateLabel(urgentState)}
                  className="flex shrink-0 items-center"
                >
                  <AgentSessionStatusIcon state={urgentState} />
                </span>
              )}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
              <span
                className={cn(
                  "truncate",
                  gitStatus?.isGit && "max-w-[45%]",
                )}
                title={agentWorkspaceHostLabel(group)}
              >
                {agentWorkspaceHostLabel(group)}
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
          <>
            {canCreateWorktree && (
              <button
                type="button"
                onClick={() => setWorktreeOpen(true)}
                aria-label={`New worktree from ${group.name}`}
                title={`New worktree from ${group.name}`}
                className={cn(
                  "absolute inset-y-0 right-7 flex w-7 items-center justify-center rounded-md text-muted-foreground motion-colors hover:text-foreground focus-visible:text-foreground max-md:right-11 max-md:w-11",
                  motionClasses.hoverReveal,
                )}
              >
                <GitBranchPlus className="size-3.5" />
              </button>
            )}
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
          </>
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
            // Worktrees follow their workspace; keep the column for alignment.
            sortGroup !== undefined && "invisible",
          )}
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <ul
        id={sessionListId}
        hidden={!open}
        className={cn("mt-0.5 flex-col gap-0.5", open ? "flex" : "hidden")}
      >
        {open && (
          <>
            {visibleSessions.map((item) => {
              const state = agentSessionState(item.session);
              return (
                <AgentSessionRow
                  key={item.session.id}
                  entry={{
                    item,
                    group,
                    state,
                    since: agentSessionStateSince(item.session, state),
                  }}
                  now={now}
                  context="workspace"
                />
              );
            })}
            {filteredSessions.length === 0 && (
              <li className="py-1.5 pr-2 pl-4 text-xs text-muted-foreground">
                No{" "}
                {providerFilter
                  ? `${agentProviderMetadata(providerFilter).label} sessions`
                  : "sessions"}
              </li>
            )}
            {filteredSessions.length > AGENT_SESSION_PREVIEW_COUNT &&
              (sessionsExpanded || hiddenSessionCount > 0) && (
                <AgentSessionListToggle
                  expanded={sessionsExpanded}
                  hiddenCount={hiddenSessionCount}
                  onToggle={() => setSessionsExpanded((current) => !current)}
                  controls={sessionListId}
                />
              )}
          </>
        )}
      </ul>
      {worktrees.length > 0 && (
        <ul
          aria-label={`Worktrees of ${group.name}`}
          hidden={!open}
          className={cn("mt-0.5 flex-col gap-0.5 pl-3", open ? "flex" : "hidden")}
        >
          {worktrees.map(renderWorktree)}
        </ul>
      )}
      {canCreateWorktree && (
        <NewAgentWorktreeDialog
          open={worktreeOpen}
          onOpenChange={setWorktreeOpen}
          workspaceId={representativeWorkspace.id}
          workspaceName={group.name}
          provider={representativeTarget.connection.provider}
          onCreated={() => onExpandedChange(true)}
        />
      )}
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
      className="flex min-w-0 flex-1 items-center gap-1"
      title={detail}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <GitBranch aria-hidden="true" className="size-3 shrink-0" />
        <span className="truncate">{status.branch ?? "Detached HEAD"}</span>
      </span>
      {status.dirty && (
        <span
          className="flex shrink-0 items-center gap-0.5 tabular-nums text-amber-500"
          aria-label={`${status.changedFiles} changed file${status.changedFiles === 1 ? "" : "s"}`}
        >
          <FileDiff aria-hidden="true" className="size-3" />
          {status.changedFiles}
        </span>
      )}
    </span>
  );
}

