"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { SidebarToggle } from "@/components/SidebarToggle";
import { toast } from "@/components/ui/toast";
import type {
  AgentModel,
  AgentProviderId,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import {
  buildAgentPromptCommand,
  normalizeAgentSessionCommand,
} from "@/lib/agents/pi/commands";
import { agentProviderMetadata } from "@/lib/agents/catalog";
import {
  useAgentSession,
  useAgentSessionCommand,
} from "@/lib/queries/agentSessions";
import { motionClasses } from "@/lib/motion";
import { AgentComposer } from "./AgentComposer";
import {
  AgentExtensionDialog,
  CompactAgentSessionDialog,
  RenameAgentSessionDialog,
} from "./AgentSessionDialogs";
import { AgentMessageList } from "./AgentMessageList";
import type { AgentRunActivity } from "./AgentMessageList";
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
  ) {
    setDialogError("");
    try {
      const result = await command.mutateAsync(input);
      if (input.type === "new_session") {
        if (!result.sessionId) {
          throw new Error(`${providerLabel} did not return the new session.`);
        }
        router.push(`/agents/${result.sessionId}`);
        return;
      }
      if (options.closeRename) setRenameOpen(false);
      if (options.closeCompact) setCompactOpen(false);
      if (options.toastTitle) toast.success({ title: options.toastTitle });
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : `${providerLabel} command failed.`;
      if (renameOpen || compactOpen || snapshot?.pendingExtensionRequest) {
        setDialogError(message);
      } else {
        toast.error({
          title: `${providerLabel} command failed`,
          description: message,
        });
      }
    }
  }

  function submit(message: string) {
    let input: AgentSessionCommand;
    try {
      input = normalizeAgentSessionCommand(
        provider,
        buildAgentPromptCommand(message),
        snapshot?.state ?? {},
      );
    } catch (cause) {
      toast.error({
        title: `${providerLabel} command failed`,
        description:
          cause instanceof Error
            ? cause.message
            : `Invalid ${providerLabel} command.`,
      });
      return;
    }

    const toastTitle =
      input.type === "compact"
        ? "Context compacted"
        : input.type === "set_session_name"
          ? "Session renamed"
          : input.type === "set_auto_compaction"
            ? `Auto-compaction ${input.enabled ? "enabled" : "disabled"}`
            : undefined;
    void run(input, { toastTitle });
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

      <AgentMessageList
        providerLabel={providerLabel}
        messages={snapshot.messages}
        streaming={running}
        activity={activity}
        activityStartedAt={activityStartedAt}
        error={runtimeError}
        workspaceName={workspaceName}
      />

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <AgentComposer
            providerLabel={providerLabel}
            commands={snapshot.commands}
            queuedMessages={snapshot.queuedMessages}
            running={running}
            pending={command.isPending}
            stopping={pendingCommand === "abort"}
            disabled={exited || Boolean(snapshot.pendingExtensionRequest)}
            onSubmit={submit}
            onStop={() => void run({ type: "abort" })}
            onSteerQueued={(id) =>
              void run({ type: "steer_queued_message", id })
            }
            onRemoveQueued={(id) =>
              void run({ type: "remove_queued_message", id })
            }
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
      <AgentExtensionDialog
        providerLabel={providerLabel}
        request={snapshot.pendingExtensionRequest}
        pending={command.isPending}
        error={dialogError}
        onRespond={(response) =>
          void run({
            type: "extension_ui_response",
            id: snapshot.pendingExtensionRequest!.id,
            ...response,
          })
        }
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
