"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarToggle } from "@/components/SidebarToggle";
import { toast } from "@/components/ui/toast";
import { AGENT_GOAL_STATUSES } from "@overtchat/agent-bridge";
import type {
  AgentCollaborationMode,
  AgentGoal,
  AgentMode,
  AgentPromptImage,
  AgentProviderId,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import {
  useAgentSession,
  useAgentSessionCommand,
  useAgentSessionUsage,
} from "@/lib/queries/agentSessions";
import { commandForAgentSessionSubmit } from "@/lib/agents/sessionCommands";
import { latestAgentTaskList } from "@/lib/agents/presentation";
import {
  AGENT_CREATE_PREFERENCES_KEY,
  DEFAULT_AGENT_CREATE_PREFERENCES,
  mergeAgentProviderPreferences,
  parseAgentCreatePreferences,
} from "@/lib/agents/createPreferences";
import { motionClasses } from "@/lib/motion";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";
import { AgentComposer } from "./AgentComposer";
import {
  AgentInteractionDialog,
  AgentUsageDialog,
  CompactAgentSessionDialog,
  RenameAgentSessionDialog,
} from "./AgentSessionDialogs";
import { AgentMessageList } from "./AgentMessageList";
import type { AgentRunActivity } from "./AgentActivity";
import { AgentSessionContext } from "./AgentSessionContext";
import { AgentSessionHeader } from "./AgentSessionHeader";
import { AgentWorkspacePane } from "./AgentWorkspacePane";
import {
  AgentWorkspaceNavigationProvider,
  type AgentWorkspaceFileSelection,
} from "./AgentWorkspaceNavigationContext";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_WORKSPACE_PANE_WIDTH = 512;
const MIN_WORKSPACE_PANE_WIDTH = 352;
const MAX_WORKSPACE_PANE_WIDTH = 960;
const MIN_TRANSCRIPT_WIDTH = 480;
const WORKSPACE_PANE_WIDTH_KEY = "overtchat:agent-workspace-pane-width";

function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function currentModel(
  snapshot: AgentRuntimeSnapshot,
): { provider: string; id: string } | null {
  const model = recordOf(snapshot.state.model);
  return typeof model?.provider === "string" &&
    typeof model.id === "string"
    ? { provider: model.provider, id: model.id }
    : null;
}

function currentThinking(
  snapshot: AgentRuntimeSnapshot,
  model: AgentRuntimeSnapshot["models"][number] | undefined,
): string | null {
  const level = snapshot.state.thinkingLevel;
  return typeof level === "string" &&
    model?.thinkingOptions?.some((option) => option.id === level)
    ? level
    : null;
}

function sessionName(snapshot: AgentRuntimeSnapshot): string {
  const value = snapshot.state.sessionName;
  return typeof value === "string" ? value : "";
}

function collaborationModes(
  snapshot: AgentRuntimeSnapshot,
): AgentCollaborationMode[] {
  const value = snapshot.state.collaborationModes;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (mode): mode is AgentCollaborationMode =>
      mode === "default" || mode === "plan",
  );
}

function currentCollaborationMode(
  snapshot: AgentRuntimeSnapshot,
): AgentCollaborationMode {
  return snapshot.state.collaborationMode === "plan" ? "plan" : "default";
}

function agentModes(snapshot: AgentRuntimeSnapshot): AgentMode[] {
  const value = snapshot.state.modes;
  if (!Array.isArray(value)) return [];
  return value.flatMap((value) => {
    const mode = recordOf(value);
    return typeof mode?.id === "string" &&
      typeof mode.label === "string" &&
      typeof mode.description === "string"
      ? [{
          id: mode.id,
          label: mode.label,
          description: mode.description,
          ...(mode.dangerous === true ? { dangerous: true } : {}),
        }]
      : [];
  });
}

function currentModeId(snapshot: AgentRuntimeSnapshot): string {
  return typeof snapshot.state.modeId === "string"
    ? snapshot.state.modeId
    : "";
}

function currentGoal(snapshot: AgentRuntimeSnapshot): AgentGoal | null {
  const goal = recordOf(snapshot.state.goal);
  if (
    typeof goal?.objective !== "string" ||
    typeof goal.status !== "string" ||
    !AGENT_GOAL_STATUSES.includes(goal.status as AgentGoal["status"])
  ) {
    return null;
  }
  return {
    objective: goal.objective,
    status: goal.status as AgentGoal["status"],
    tokenBudget:
      typeof goal.tokenBudget === "number" ? goal.tokenBudget : null,
    tokensUsed: typeof goal.tokensUsed === "number" ? goal.tokensUsed : 0,
    timeUsedSeconds:
      typeof goal.timeUsedSeconds === "number" ? goal.timeUsedSeconds : 0,
    createdAt: typeof goal.createdAt === "number" ? goal.createdAt : 0,
    updatedAt: typeof goal.updatedAt === "number" ? goal.updatedAt : 0,
  };
}

function forkDraftKey(sessionId: string): string {
  return `overtchat:agent-fork-draft:${sessionId}`;
}

function workspaceFileSelection(value: unknown): AgentWorkspaceFileSelection | null {
  const record = recordOf(value);
  if (!record || typeof record.path !== "string" || !record.path) return null;
  const lineStart =
    typeof record.lineStart === "number" && record.lineStart > 0
      ? record.lineStart
      : undefined;
  const lineEnd =
    typeof record.lineEnd === "number" && record.lineEnd >= (lineStart ?? 1)
      ? record.lineEnd
      : undefined;
  return {
    path: record.path,
    ...(lineStart ? { lineStart } : {}),
    ...(lineEnd ? { lineEnd } : {}),
  };
}

function workspaceFileSelections(value: unknown): AgentWorkspaceFileSelection[] {
  if (!Array.isArray(value)) return [];
  const selections = value.flatMap((entry) => {
    const selection = workspaceFileSelection(entry);
    return selection ? [selection] : [];
  });
  return selections.filter(
    (selection, index) =>
      selections.findIndex((candidate) => candidate.path === selection.path) ===
      index,
  );
}

function clampWorkspacePaneWidth(width: number, viewportWidth: number): number {
  const maximum = Math.max(
    MIN_WORKSPACE_PANE_WIDTH,
    Math.min(MAX_WORKSPACE_PANE_WIDTH, viewportWidth - MIN_TRANSCRIPT_WIDTH),
  );
  return Math.min(maximum, Math.max(MIN_WORKSPACE_PANE_WIDTH, width));
}

export function AgentSessionView({
  sessionId,
  provider,
  workspaceId,
  workspaceName,
  workspacePath,
  initialSessionName,
}: {
  sessionId: string;
  provider: AgentProviderId;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  initialSessionName: string;
}) {
  const providerLabel = agentProviderMetadata(provider).label;
  const router = useRouter();
  const session = useAgentSession(sessionId);
  const command = useAgentSessionCommand(sessionId);
  const usageCommand = useAgentSessionUsage(sessionId);
  const [storedPreferences, setStoredPreferences] = useLocalStorage<unknown>(
    AGENT_CREATE_PREFERENCES_KEY,
    DEFAULT_AGENT_CREATE_PREFERENCES,
  );
  const preferences = useMemo(
    () => parseAgentCreatePreferences(storedPreferences),
    [storedPreferences],
  );
  const [renameOpen, setRenameOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [usage, setUsage] = useState<AgentUsageSnapshot | null>(null);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState<{
    revision: number;
    text: string;
  } | null>(null);
  const [filesOpen, setFilesOpen] = useLocalStorage<boolean>(
    `overtchat:agent-workspace-pane:${sessionId}`,
    false,
  );
  const [storedFileSelection, setStoredFileSelection] =
    useLocalStorage<unknown>(
      `overtchat:agent-workspace-file:${sessionId}`,
      null,
    );
  const [storedOpenFiles, setStoredOpenFiles] = useLocalStorage<unknown>(
    `overtchat:agent-workspace-tabs:${sessionId}`,
    [],
  );
  const [storedPaneWidth, setStoredPaneWidth] = useLocalStorage<unknown>(
    WORKSPACE_PANE_WIDTH_KEY,
    DEFAULT_WORKSPACE_PANE_WIDTH,
  );
  const selectedFile = useMemo(
    () => workspaceFileSelection(storedFileSelection),
    [storedFileSelection],
  );
  const openFiles = useMemo(
    () => workspaceFileSelections(storedOpenFiles),
    [storedOpenFiles],
  );
  const [viewportWidth, setViewportWidth] = useState(1440);
  const [dragPaneWidth, setDragPaneWidth] = useState<number | null>(null);
  const [resizingPane, setResizingPane] = useState(false);
  const resizeStart = useRef<{ pointerX: number; width: number } | null>(null);
  const preferredPaneWidth =
    typeof storedPaneWidth === "number" && Number.isFinite(storedPaneWidth)
      ? storedPaneWidth
      : DEFAULT_WORKSPACE_PANE_WIDTH;
  const paneWidth =
    dragPaneWidth ?? clampWorkspacePaneWidth(preferredPaneWidth, viewportWidth);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth);
    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    if (
      !selectedFile ||
      openFiles.some((candidate) => candidate.path === selectedFile.path)
    ) {
      return;
    }
    setStoredOpenFiles([...openFiles, selectedFile]);
  }, [openFiles, selectedFile, setStoredOpenFiles]);

  const openWorkspaceFile = useCallback(
    (selection: AgentWorkspaceFileSelection) => {
      const existing = openFiles.findIndex(
        (candidate) => candidate.path === selection.path,
      );
      const next = [...openFiles];
      if (existing >= 0) next[existing] = selection;
      else next.push(selection);
      setStoredOpenFiles(next);
      setStoredFileSelection(selection);
      setFilesOpen(true);
    },
    [openFiles, setFilesOpen, setStoredFileSelection, setStoredOpenFiles],
  );
  const activateWorkspaceFile = useCallback(
    (path: string) => {
      const selection = openFiles.find((candidate) => candidate.path === path);
      if (selection) setStoredFileSelection(selection);
    },
    [openFiles, setStoredFileSelection],
  );
  const closeWorkspaceFile = useCallback(
    (path: string) => {
      const index = openFiles.findIndex((candidate) => candidate.path === path);
      if (index < 0) return;
      const next = openFiles.filter((candidate) => candidate.path !== path);
      setStoredOpenFiles(next);
      if (selectedFile?.path === path) {
        setStoredFileSelection(next[index] ?? next[index - 1] ?? null);
      }
    },
    [openFiles, selectedFile?.path, setStoredFileSelection, setStoredOpenFiles],
  );

  function paneWidthFromPointer(pointerX: number): number {
    const start = resizeStart.current;
    if (!start) return paneWidth;
    return clampWorkspacePaneWidth(
      start.width + start.pointerX - pointerX,
      viewportWidth,
    );
  }

  function startPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeStart.current = { pointerX: event.clientX, width: paneWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragPaneWidth(paneWidth);
    setResizingPane(true);
  }

  function movePaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    event.preventDefault();
    setDragPaneWidth(paneWidthFromPointer(event.clientX));
  }

  function finishPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!resizeStart.current) return;
    const width = paneWidthFromPointer(event.clientX);
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setStoredPaneWidth(width);
    setDragPaneWidth(null);
    setResizingPane(false);
  }

  function cancelPaneResize(event: ReactPointerEvent<HTMLDivElement>) {
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragPaneWidth(null);
    setResizingPane(false);
  }

  function resizePaneWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 24;
    let width: number | null = null;
    if (event.key === "ArrowLeft") width = paneWidth + step;
    if (event.key === "ArrowRight") width = paneWidth - step;
    if (event.key === "Home") width = MIN_WORKSPACE_PANE_WIDTH;
    if (event.key === "End") width = MAX_WORKSPACE_PANE_WIDTH;
    if (width === null) return;
    event.preventDefault();
    setStoredPaneWidth(clampWorkspacePaneWidth(width, viewportWidth));
  }
  const workspaceNavigation = useMemo(
    () => ({ openFile: openWorkspaceFile }),
    [openWorkspaceFile],
  );
  const snapshot = session.data;

  useEffect(() => {
    const title = snapshot
      ? sessionName(snapshot) || initialSessionName
      : initialSessionName;
    document.title = `${title.trim() || workspaceName} · ${providerLabel}`;
  }, [initialSessionName, providerLabel, snapshot, workspaceName]);

  async function run(
    input: AgentSessionCommand,
    options: {
      closeRename?: boolean;
      closeCompact?: boolean;
      toastTitle?: string;
    } = {},
  ): Promise<boolean> {
    setDialogError("");
    try {
      const result = await command.mutateAsync(input);
      if (result.notice) {
        toast.warning(result.notice.message);
      }
      if (
        input.type === "edit_message" ||
        input.type === "fork_message"
      ) {
        if (!result.sessionId) {
          throw new Error(`${providerLabel} did not return the forked session.`);
        }
        const draft = result.draft;
        if (draft !== undefined) {
          if (result.sessionId === sessionId) {
            setRestoredDraft((current) => ({
              revision: (current?.revision ?? 0) + 1,
              text: draft,
            }));
            return true;
          }
          window.sessionStorage.setItem(
            forkDraftKey(result.sessionId),
            draft,
          );
        }
        router.push(`/agents/${result.sessionId}`);
        return true;
      }
      if (input.type === "new_session") {
        if (!result.sessionId) {
          throw new Error(`${providerLabel} did not return the new session.`);
        }
        router.push(`/agents/${result.sessionId}`);
        return true;
      }
      if (options.closeRename) setRenameOpen(false);
      if (options.closeCompact) setCompactOpen(false);
      if (options.toastTitle) toast.success({ title: options.toastTitle });
      return true;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : `${providerLabel} command failed.`;
      if (renameOpen || compactOpen || snapshot?.pendingInteraction) {
        setDialogError(message);
      } else {
        toast.error({
          title: `${providerLabel} command failed`,
          description: message,
        });
      }
      return false;
    }
  }

  async function showUsage(): Promise<boolean> {
    if (usageCommand.isPending) return false;
    setUsage(null);
    setUsageError("");
    setUsageOpen(true);
    try {
      setUsage(await usageCommand.mutateAsync());
      return true;
    } catch (cause) {
      setUsageError(
        cause instanceof Error
          ? cause.message
          : "Codex account usage could not be loaded.",
      );
      return false;
    }
  }

  async function submit(
    message: string,
    images: AgentPromptImage[],
  ): Promise<boolean> {
    let input: AgentSessionCommand;
    try {
      input = commandForAgentSessionSubmit(snapshot!, message, images);
    } catch (cause) {
      toast.error({
        title: `${providerLabel} command failed`,
        description:
          cause instanceof Error
            ? cause.message
            : `Invalid ${providerLabel} command.`,
      });
      return false;
    }

    if (input.type === "show_usage") return showUsage();

    const toastTitle =
      input.type === "compact"
        ? "Compaction started"
        : input.type === "set_session_name"
          ? "Session renamed"
          : input.type === "set_auto_compaction"
            ? `Auto-compaction ${input.enabled ? "enabled" : "disabled"}`
            : undefined;
    return run(input, { toastTitle });
  }

  if (session.isPending) {
    return <AgentSessionLoading providerLabel={providerLabel} />;
  }
  if (!snapshot) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center border-b px-3">
          <SidebarToggle />
        </header>
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md text-center">
            <AlertTriangle className="mx-auto size-5 text-destructive" />
            <p className="mt-3 text-sm font-medium">
              {providerLabel} session could not be opened
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {session.error instanceof Error
                ? session.error.message
                : "The connection failed."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const running = snapshot.status === "running";
  const exited = snapshot.status === "exited";
  const readOnly = snapshot.readOnly;
  const model = currentModel(snapshot);
  const selectedModel = model
    ? snapshot.models.find(
        (candidate) =>
          candidate.provider === model.provider &&
          candidate.id === model.id,
      )
    : undefined;
  const thinking = currentThinking(snapshot, selectedModel);
  const currentName = sessionName(snapshot) || initialSessionName;
  const availableCollaborationModes = collaborationModes(snapshot);
  const collaborationMode = currentCollaborationMode(snapshot);
  const fastModeEnabled = snapshot.state.fastModeEnabled === true;
  const fastModeAvailable = snapshot.state.fastModeAvailable === true;
  const availableModes = agentModes(snapshot);
  const modeId = currentModeId(snapshot);
  const goal = currentGoal(snapshot);
  const tasks = latestAgentTaskList(snapshot.messages);
  const runtimeError =
    snapshot.error ??
    (session.error instanceof Error ? session.error.message : undefined);
  const pendingCommand = command.isPending ? command.variables?.type : null;
  const activity: AgentRunActivity | null =
    pendingCommand === "abort"
      ? "stopping"
      : pendingCommand === "compact" || snapshot.state.isCompacting === true
        ? "compacting"
        : session.streamStatus === "reconnecting"
          ? "reconnecting"
          : running
            ? "working"
            : null;
  const activityStartedAt =
    activity === "working"
      ? snapshot.activeTurn?.startedAt ?? null
      : (activity === "stopping" || pendingCommand === "compact") &&
          command.submittedAt > 0
        ? command.submittedAt
        : null;
  const composerDisabled =
    exited || Boolean(readOnly) || Boolean(snapshot.pendingInteraction);
  const controlsDisabled = composerDisabled || command.isPending;

  return (
    <AgentWorkspaceNavigationProvider value={workspaceNavigation}>
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AgentSessionHeader
            provider={provider}
            workspaceId={workspaceId}
            workspacePath={workspacePath}
            stats={snapshot.stats}
            running={running}
            commandPending={command.isPending}
            readOnly={Boolean(readOnly)}
            filesOpen={filesOpen}
            onToggleFiles={() => setFilesOpen(!filesOpen)}
            onRename={() => {
              setDialogError("");
              setRenameOpen(true);
            }}
            onCompact={() => {
              setDialogError("");
              setCompactOpen(true);
            }}
          />

          {readOnly && (
            <section
              aria-label={`Read-only ${providerLabel} session`}
              className="border-b bg-muted/30 px-4 py-3"
            >
              <div className="mx-auto flex max-w-3xl items-start gap-3">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                  {readOnly.reason}
                </p>
                {readOnly.retryable && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={command.isPending}
                    onClick={() => void run({ type: "retry_interactive" })}
                  >
                    <RefreshCw
                      className={
                        pendingCommand === "retry_interactive"
                          ? motionClasses.spinner
                          : undefined
                      }
                    />
                    Retry
                  </Button>
                )}
              </div>
            </section>
          )}

          <AgentMessageList
            providerLabel={providerLabel}
            messages={snapshot.messages}
            streaming={running}
            activity={activity}
            activityStartedAt={activityStartedAt}
            error={runtimeError}
            workspaceName={workspaceName}
            canEditMessages={
              snapshot.capabilities.editSentMessages === true
            }
            canForkMessages={snapshot.capabilities.forkMessages === true}
            actionsDisabled={
              running ||
              exited ||
              command.isPending ||
              Boolean(snapshot.pendingInteraction)
            }
            suppressScrollButton={composerMenuOpen}
            onEditMessage={(messageId) =>
              void run({ type: "edit_message", messageId })
            }
            onForkMessage={(messageId) =>
              void run({ type: "fork_message", messageId })
            }
            onImplementPlan={(plan) =>
              void run({ type: "implement_plan", plan })
            }
          />

          <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-3xl">
              <AgentSessionContext
                goal={goal}
                tasks={tasks}
                goalActionsDisabled={Boolean(readOnly) || command.isPending}
                onPauseGoal={() =>
                  void run(
                    { type: "update_goal", action: "pause" },
                    { toastTitle: "Goal paused" },
                  )
                }
                onResumeGoal={() =>
                  void run(
                    { type: "update_goal", action: "resume" },
                    { toastTitle: "Goal resumed" },
                  )
                }
                onClearGoal={() =>
                  void run(
                    { type: "update_goal", action: "clear" },
                    { toastTitle: "Goal cleared" },
                  )
                }
              />
              <AgentComposer
                key={sessionId}
                providerLabel={providerLabel}
                commands={snapshot.commands}
                queuedMessages={snapshot.queuedMessages}
                supportsSteer={snapshot.capabilities.steer}
                supportsImages={selectedModel?.input.includes("image") === true}
                running={running}
                pending={command.isPending}
                stopping={pendingCommand === "abort"}
                disabled={composerDisabled}
                controls={{
                  providerLabel,
                  models: snapshot.models,
                  currentModel: model,
                  thinkingLevel: thinking,
                  thinkingOptions: selectedModel?.thinkingOptions ?? [],
                  collaborationMode,
                  collaborationModes: availableCollaborationModes,
                  fastModeEnabled,
                  fastModeAvailable,
                  modeId,
                  modes: availableModes,
                  disabled: controlsDisabled,
                  onSelectModel: (selected) => {
                    void run({
                      type: "set_model",
                      modelId: selected.id,
                    }).then((changed) => {
                      if (!changed) return;
                      setStoredPreferences(
                        mergeAgentProviderPreferences({
                          preferences,
                          provider,
                          updates: { model: selected.id },
                        }),
                      );
                    });
                  },
                  onSelectThinking: (level) => {
                    if (selectedModel) {
                      setStoredPreferences(
                        mergeAgentProviderPreferences({
                          preferences,
                          provider,
                          updates: {
                            model: selectedModel.id,
                            thinkingByModel: { [selectedModel.id]: level },
                          },
                        }),
                      );
                    }
                    void run({ type: "set_thinking_level", level });
                  },
                  onSelectCollaborationMode: (mode) =>
                    void run({ type: "set_collaboration_mode", mode }),
                  onToggleFastMode: (enabled) =>
                    void run({ type: "set_fast_mode", enabled }),
                  onSelectMode: (selectedModeId) => {
                    setStoredPreferences(
                      mergeAgentProviderPreferences({
                        preferences,
                        provider,
                        updates: { mode: selectedModeId },
                      }),
                    );
                    if (running && provider !== "omp") {
                      toast.success("Permission mode applies next turn");
                    }
                    void run({ type: "set_mode", modeId: selectedModeId });
                  },
                  onMenuOpenChange: setComposerMenuOpen,
                }}
                contextUsage={snapshot.stats.contextUsage}
                onSubmit={submit}
                onStop={() => void run({ type: "abort" })}
                onEditQueued={(id) =>
                  run({ type: "remove_queued_message", id })
                }
                onDeleteQueued={(id) =>
                  run({ type: "remove_queued_message", id })
                }
                onSteerQueued={(id) =>
                  run({ type: "steer_queued_message", id })
                }
                restoreDraftKey={forkDraftKey(sessionId)}
                restoredDraft={restoredDraft}
              />
            </div>
          </div>

          <RenameAgentSessionDialog
            providerLabel={providerLabel}
            open={renameOpen}
            initialName={currentName}
            pending={command.isPending}
            error={dialogError}
            onOpenChange={(open) => {
              setDialogError("");
              setRenameOpen(open);
            }}
            onSubmit={(name) =>
              void run(
                { type: "set_session_name", name },
                { closeRename: true, toastTitle: "Session renamed" },
              )
            }
          />
          <CompactAgentSessionDialog
            providerLabel={providerLabel}
            supportsCustomInstructions={
              snapshot.capabilities.customCompactionInstructions === true
            }
            open={compactOpen}
            pending={command.isPending}
            error={dialogError}
            onOpenChange={(open) => {
              setDialogError("");
              setCompactOpen(open);
            }}
            onSubmit={(customInstructions) =>
              void run(
                {
                  type: "compact",
                  ...(customInstructions ? { customInstructions } : {}),
                },
                { closeCompact: true, toastTitle: "Compaction started" },
              )
            }
          />
          <AgentInteractionDialog
            providerLabel={providerLabel}
            request={snapshot.pendingInteraction}
            pending={command.isPending}
            error={dialogError}
            onRespond={(response) =>
              void run({
                type: "interaction_response",
                id: snapshot.pendingInteraction!.id,
                ...response,
              })
            }
          />
          <AgentUsageDialog
            open={usageOpen}
            usage={usage}
            pending={usageCommand.isPending}
            error={usageError}
            onOpenChange={(open) => {
              setUsageOpen(open);
              if (!open) {
                setUsage(null);
                setUsageError("");
              }
            }}
          />
        </div>

        <button
          type="button"
          aria-label="Close workspace files"
          tabIndex={filesOpen ? 0 : -1}
          onClick={() => setFilesOpen(false)}
          className={cn(
            "absolute inset-0 z-20 bg-black/35 motion-overlay xl:hidden",
            filesOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        />
        <div
          aria-hidden={!filesOpen}
          inert={!filesOpen}
          style={
            {
              "--workspace-pane-width": `${paneWidth}px`,
            } as CSSProperties
          }
          className={cn(
            "absolute inset-y-0 right-0 z-30 w-[min(34rem,calc(100%-1rem))] overflow-hidden xl:relative xl:z-auto xl:w-0 xl:shrink-0 xl:shadow-none",
            !resizingPane && "xl:motion-width",
            filesOpen
              ? "pointer-events-auto xl:w-(--workspace-pane-width)"
              : "pointer-events-none xl:w-0",
          )}
        >
          <div
            role="separator"
            aria-label="Resize workspace files"
            aria-orientation="vertical"
            aria-valuemin={MIN_WORKSPACE_PANE_WIDTH}
            aria-valuemax={clampWorkspacePaneWidth(
              MAX_WORKSPACE_PANE_WIDTH,
              viewportWidth,
            )}
            aria-valuenow={Math.round(paneWidth)}
            tabIndex={filesOpen ? 0 : -1}
            data-testid="agent-workspace-resize-handle"
            onPointerDown={startPaneResize}
            onPointerMove={movePaneResize}
            onPointerUp={finishPaneResize}
            onPointerCancel={cancelPaneResize}
            onDoubleClick={() =>
              setStoredPaneWidth(DEFAULT_WORKSPACE_PANE_WIDTH)
            }
            onKeyDown={resizePaneWithKeyboard}
            className={cn(
              "group absolute inset-y-0 left-0 z-40 hidden w-2 touch-none cursor-col-resize outline-none select-none xl:block",
              resizingPane && "cursor-col-resize",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 w-px bg-border motion-colors group-hover:bg-primary/70 group-focus-visible:w-0.5 group-focus-visible:bg-primary",
                resizingPane && "w-0.5 bg-primary",
              )}
            />
          </div>
          <div
            className={cn(
              "absolute inset-y-0 right-0 h-full w-full bg-background shadow-xl motion-transform xl:w-(--workspace-pane-width) xl:shadow-none",
              filesOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            <AgentWorkspacePane
              workspaceId={workspaceId}
              workspaceName={workspaceName}
              selection={selectedFile}
              openFiles={openFiles}
              running={running}
              onSelect={openWorkspaceFile}
              onActivateFiles={() => setStoredFileSelection(null)}
              onActivateFile={activateWorkspaceFile}
              onCloseFile={closeWorkspaceFile}
              onClose={() => setFilesOpen(false)}
            />
          </div>
        </div>
      </div>
    </AgentWorkspaceNavigationProvider>
  );
}

function AgentSessionLoading({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="size-8 rounded-md motion-skeleton" />
        <div className="h-4 w-48 rounded motion-skeleton" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className={`size-5 text-muted-foreground ${motionClasses.spinner}`}
          aria-label={`Opening ${providerLabel} session`}
        />
      </div>
      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto h-24 max-w-3xl rounded-3xl motion-skeleton" />
      </div>
    </div>
  );
}
