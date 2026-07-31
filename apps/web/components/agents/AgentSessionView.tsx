"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { SidebarToggle } from "@/components/SidebarToggle";
import { toast } from "@/components/ui/toast";
import type {
  AgentModel,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import { normalizePiSessionCommand } from "@/lib/agents/pi/commands";
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
  workspaceName,
  initialSessionName,
}: {
  sessionId: string;
  workspaceName: string;
  initialSessionName: string;
}) {
  const router = useRouter();
  const session = useAgentSession(sessionId);
  const command = useAgentSessionCommand(sessionId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [compactOpen, setCompactOpen] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const snapshot = session.data;

  useEffect(() => {
    const title = snapshot ? sessionName(snapshot) : initialSessionName;
    document.title = `${title.trim() || workspaceName} · Pi`;
  }, [initialSessionName, snapshot, workspaceName]);

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
          throw new Error("Pi did not return the new session.");
        }
        router.push(`/agents/${result.sessionId}`);
        return;
      }
      if (options.closeRename) setRenameOpen(false);
      if (options.closeCompact) setCompactOpen(false);
      if (options.toastTitle) toast.success({ title: options.toastTitle });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Pi command failed.";
      if (renameOpen || compactOpen || snapshot?.pendingExtensionRequest) {
        setDialogError(message);
      } else {
        toast.error({ title: "Pi command failed", description: message });
      }
    }
  }

  function submit(message: string) {
    let input: AgentSessionCommand;
    try {
      input = normalizePiSessionCommand(
        {
          type: "prompt",
          message,
          ...(snapshot?.status === "running"
            ? { streamingBehavior: "steer" as const }
            : {}),
        },
        snapshot?.state ?? {},
      );
    } catch (cause) {
      toast.error({
        title: "Pi command failed",
        description:
          cause instanceof Error ? cause.message : "Invalid Pi command.",
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

  if (session.isPending) return <AgentSessionLoading />;
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
              Pi session could not be opened
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <AgentSessionHeader
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
        messages={snapshot.messages}
        streaming={running}
        error={runtimeError}
        workspaceName={workspaceName}
      />

      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <AgentComposer
            commands={snapshot.commands}
            running={running}
            pending={command.isPending}
            disabled={exited || Boolean(snapshot.pendingExtensionRequest)}
            onSubmit={submit}
            onStop={() => void run({ type: "abort" })}
          />
        </div>
      </div>

      <RenameAgentSessionDialog
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

function AgentSessionLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <div className="size-8 rounded-md motion-skeleton" />
        <div className="h-4 w-48 rounded motion-skeleton" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className={`size-5 text-muted-foreground ${motionClasses.spinner}`}
          aria-label="Opening Pi session"
        />
      </div>
      <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto h-24 max-w-3xl rounded-3xl motion-skeleton" />
      </div>
    </div>
  );
}
