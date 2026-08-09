"use client";

import { useEffect, useState } from "react";
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
import type {
  AgentModel,
  AgentProviderId,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
  AgentThinkingLevel,
  AgentUsageSnapshot,
} from "@/lib/agents/types";
import {
  buildAgentPromptCommand,
  normalizeAgentSessionCommand,
} from "@/lib/agents/runtime/commands";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  useAgentSession,
  useAgentSessionCommand,
} from "@/lib/queries/agentSessions";
import { motionClasses } from "@/lib/motion";
import { AgentComposer } from "./AgentComposer";
import {
  AgentInteractionDialog,
  AgentUsageDialog,
  CompactAgentSessionDialog,
  RenameAgentSessionDialog,
} from "./AgentSessionDialogs";
import { AgentMessageList } from "./AgentMessageList";
import type { AgentRunActivity } from "./AgentActivity";
import { AgentSessionHeader } from "./AgentSessionHeader";

type UnknownRecord = Record<string, unknown>;

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
): AgentThinkingLevel | null {
  const level = snapshot.state.thinkingLevel;
  return typeof level === "string" &&
    snapshot.thinkingLevels.includes(level as AgentThinkingLevel)
    ? (level as AgentThinkingLevel)
    : null;
}

function sessionName(snapshot: AgentRuntimeSnapshot): string {
  const value = snapshot.state.sessionName;
  return typeof value === "string" ? value : "";
}

function forkDraftKey(sessionId: string): string {
  return `overtchat:agent-fork-draft:${sessionId}`;
}

export function AgentSessionView({
  sessionId,
  provider,
  workspaceName,
  initialSessionName,
}: {
  sessionId: string;
  provider: AgentProviderId;
  workspaceName: string;
  initialSessionName: string;
}) {
  const providerLabel = agentProviderMetadata(provider).label;
  const router = useRouter();
  const session = useAgentSession(sessionId);
  const command = useAgentSessionCommand(sessionId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [usage, setUsage] = useState<AgentUsageSnapshot | null>(null);
  const [dialogError, setDialogError] = useState("");
  const snapshot = session.data;

  useEffect(() => {
    const title = snapshot ? sessionName(snapshot) : initialSessionName;
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
      if (result.usage) setUsage(result.usage);
      if (
        input.type === "edit_message" ||
        input.type === "fork_message"
      ) {
        if (!result.sessionId) {
          throw new Error(`${providerLabel} did not return the forked session.`);
        }
        if (result.draft !== undefined) {
          window.sessionStorage.setItem(
            forkDraftKey(result.sessionId),
            result.draft,
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

  async function submit(
    message: string,
    delivery: "prompt" | "queue" | "steer",
  ): Promise<boolean> {
    let input: AgentSessionCommand;
    try {
      const normalized = normalizeAgentSessionCommand(
        buildAgentPromptCommand(message),
        snapshot?.state ?? {},
      );
      input =
        normalized.type !== "prompt" || delivery === "prompt"
          ? normalized
          : { type: delivery, message };
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

    const toastTitle =
      input.type === "compact"
        ? "Context compacted"
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
  const thinking = currentThinking(snapshot);
  const currentName = sessionName(snapshot) || initialSessionName;
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AgentSessionHeader
        providerLabel={providerLabel}
        workspaceName={workspaceName}
        models={snapshot.models}
        currentModel={model}
        thinkingLevel={thinking}
        thinkingLevels={snapshot.thinkingLevels}
        stats={snapshot.stats}
        running={running}
        commandPending={command.isPending}
        readOnly={Boolean(readOnly)}
        onSelectModel={(selected: AgentModel) =>
          void run({
            type: "set_model",
            provider: selected.provider,
            modelId: selected.id,
          })
        }
        onSelectThinking={(level) =>
          void run({ type: "set_thinking_level", level })
        }
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
        onEditMessage={(messageId) =>
          void run({ type: "edit_message", messageId })
        }
        onForkMessage={(messageId) =>
          void run({ type: "fork_message", messageId })
        }
      />

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <AgentComposer
            key={sessionId}
            providerLabel={providerLabel}
            commands={snapshot.commands}
            queuedMessages={snapshot.queuedMessages}
            supportsSteer={snapshot.capabilities.steer}
            running={running}
            pending={command.isPending}
            stopping={pendingCommand === "abort"}
            disabled={
              exited ||
              Boolean(readOnly) ||
              Boolean(snapshot.pendingInteraction)
            }
            onSubmit={submit}
            onStop={() => void run({ type: "abort" })}
            onEditQueued={(id) =>
              run({ type: "remove_queued_message", id })
            }
            onSteerQueued={(id) =>
              run({ type: "steer_queued_message", id })
            }
            restoreDraftKey={forkDraftKey(sessionId)}
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
            { closeCompact: true, toastTitle: "Context compacted" },
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
        open={Boolean(usage)}
        usage={usage}
        onOpenChange={(open) => {
          if (!open) setUsage(null);
        }}
      />
    </div>
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
