"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type {
  AgentPromptImage,
  AgentProviderId,
  AgentSessionLaunchConfig,
} from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { SidebarToggle } from "@/components/SidebarToggle";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  AGENT_CREATE_PREFERENCES_KEY,
  DEFAULT_AGENT_CREATE_PREFERENCES,
  mergeAgentProviderPreferences,
  parseAgentCreatePreferences,
} from "@/lib/agents/createPreferences";
import {
  AGENT_MODEL_DEFAULTS_LOADING_MESSAGE,
  agentSessionDraftRestoreKey,
  resolveAgentSessionDraftSelection,
} from "@/lib/agents/sessionDraft";
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
import {
  useAgentWorkspaceCatalog,
  useCreateAgentSession,
} from "@/lib/queries/agentConnections";
import { sendAgentSessionCommand } from "@/lib/queries/agentSessions";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";
import { AgentComposer } from "./AgentComposer";

export function NewAgentSessionView({
  provider,
  workspaceId,
  workspaceName,
  workspacePath,
}: {
  provider: AgentProviderId;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
}) {
  const router = useRouter();
  const providerMetadata = agentProviderMetadata(provider);
  const providerVisual = AGENT_PROVIDER_VISUALS[provider];
  const catalog = useAgentWorkspaceCatalog(workspaceId, provider);
  const createSession = useCreateAgentSession();
  const [sendingFirstPrompt, setSendingFirstPrompt] = useState(false);
  const [modelId, setModelId] = useState("");
  const [thinkingOptionId, setThinkingOptionId] = useState("");
  const [modeId, setModeId] = useState("");
  const [storedPreferences, setStoredPreferences] = useLocalStorage<unknown>(
    AGENT_CREATE_PREFERENCES_KEY,
    DEFAULT_AGENT_CREATE_PREFERENCES,
  );
  const preferences = useMemo(
    () => parseAgentCreatePreferences(storedPreferences),
    [storedPreferences],
  );
  const providerPreferences = preferences.providerPreferences?.[provider];
  const selection = useMemo(
    () =>
      resolveAgentSessionDraftSelection({
        provider,
        catalog: catalog.data,
        preferences: providerPreferences,
        modelId,
        thinkingOptionId,
        modeId,
      }),
    [
      catalog.data,
      modeId,
      modelId,
      provider,
      providerPreferences,
      thinkingOptionId,
    ],
  );
  const selectedModel = selection.model;
  const loadingDefaults = catalog.isFetching && !catalog.data;
  const pending = createSession.isPending || sendingFirstPrompt;

  useEffect(() => {
    document.title = `New ${providerMetadata.label} session · ${workspaceName}`;
  }, [providerMetadata.label, workspaceName]);

  function updateProviderPreferences(
    updates: Parameters<typeof mergeAgentProviderPreferences>[0]["updates"],
  ) {
    setStoredPreferences(
      mergeAgentProviderPreferences({ preferences, provider, updates }),
    );
  }

  async function submit(
    message: string,
    images: AgentPromptImage[],
  ): Promise<boolean> {
    if (loadingDefaults) {
      toast.error({ title: AGENT_MODEL_DEFAULTS_LOADING_MESSAGE });
      return false;
    }
    if (!catalog.data) {
      toast.error({
        title: "Model defaults could not be loaded",
        description:
          catalog.error instanceof Error
            ? catalog.error.message
            : `The ${providerMetadata.label} catalog is unavailable.`,
      });
      return false;
    }
    if (!selectedModel) {
      toast.error({ title: "Select a model" });
      return false;
    }

    const launchConfig: AgentSessionLaunchConfig = {
      model: selectedModel.id,
      ...(selection.thinkingOptionId
        ? { thinkingOptionId: selection.thinkingOptionId }
        : {}),
      ...(selection.modeId ? { modeId: selection.modeId } : {}),
    };
    updateProviderPreferences({
      model: selectedModel.id,
      ...(selection.modeId ? { mode: selection.modeId } : {}),
      ...(selection.thinkingOptionId
        ? {
            thinkingByModel: {
              [selectedModel.id]: selection.thinkingOptionId,
            },
          }
        : {}),
    });

    let sessionId: string;
    try {
      sessionId = await createSession.mutateAsync({
        workspaceId,
        provider,
        launchConfig,
      });
    } catch (cause) {
      toast.error({
        title: `Failed to start ${providerMetadata.label}`,
        description:
          cause instanceof Error
            ? cause.message
            : "A new session could not be started.",
      });
      return false;
    }

    setSendingFirstPrompt(true);
    try {
      await sendAgentSessionCommand(sessionId, {
        type: "prompt",
        message,
        ...(images.length > 0 ? { images } : {}),
        clientMessageId: crypto.randomUUID(),
      });
    } catch (cause) {
      window.sessionStorage.setItem(
        agentSessionDraftRestoreKey(sessionId),
        message,
      );
      toast.error({
        title: `${providerMetadata.label} command failed`,
        description:
          cause instanceof Error
            ? cause.message
            : "The first message could not be sent.",
      });
    } finally {
      router.replace(`/agents/${sessionId}`);
    }
    return true;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-3">
        <SidebarToggle />
        <div
          aria-label={`${providerMetadata.label} agent`}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium"
        >
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-md border bg-background",
              providerVisual.darkSurface && "bg-zinc-950",
            )}
            aria-hidden="true"
          >
            <Image
              src={providerVisual.icon}
              alt=""
              className="size-4 object-contain"
            />
          </span>
          <span className="hidden sm:inline">{providerMetadata.label}</span>
        </div>
        <span className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <span
          className="hidden max-w-40 truncate px-1 font-mono text-xs text-muted-foreground md:block lg:max-w-64 xl:max-w-96"
          title={workspacePath}
        >
          {workspacePath}
        </span>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              New {providerMetadata.label} session
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {workspaceName}
            </p>
          </div>
        </div>

        <div className="px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-3xl">
            {catalog.isError && !catalog.data && (
              <div
                role="alert"
                className="mb-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
              >
                <AlertTriangle className="size-4 shrink-0 text-destructive" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {catalog.error instanceof Error
                    ? catalog.error.message
                    : "Model defaults could not be loaded."}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={catalog.isFetching}
                  onClick={() => void catalog.refetch()}
                >
                  <RefreshCw />
                  Retry
                </Button>
              </div>
            )}
            <AgentComposer
              providerLabel={providerMetadata.label}
              commands={[]}
              queuedMessages={[]}
              supportsSteer={false}
              supportsImages={selectedModel?.input.includes("image") === true}
              running={false}
              pending={pending}
              stopping={false}
              disabled={false}
              controls={{
                providerLabel: providerMetadata.label,
                models: catalog.data?.models ?? [],
                currentModel: selectedModel
                  ? { provider: selectedModel.provider, id: selectedModel.id }
                  : null,
                thinkingLevel: selection.thinkingOptionId || null,
                thinkingOptions: selectedModel?.thinkingOptions ?? [],
                collaborationMode: "default",
                collaborationModes: [],
                fastModeEnabled: false,
                fastModeAvailable: false,
                modeId: selection.modeId,
                modes: selection.modes,
                disabled: pending,
                modelLoading: loadingDefaults,
                onSelectModel: (model) => {
                  setModelId(model.id);
                  setThinkingOptionId("");
                  updateProviderPreferences({ model: model.id });
                },
                onSelectThinking: (level) => {
                  if (!selectedModel) return;
                  setThinkingOptionId(level);
                  updateProviderPreferences({
                    model: selectedModel.id,
                    thinkingByModel: { [selectedModel.id]: level },
                  });
                },
                onSelectCollaborationMode: () => undefined,
                onToggleFastMode: () => undefined,
                onSelectMode: (selectedModeId) => {
                  setModeId(selectedModeId);
                  updateProviderPreferences({ mode: selectedModeId });
                },
              }}
              onSubmit={submit}
              onStop={() => undefined}
              onEditQueued={async () => false}
              onDeleteQueued={async () => false}
              onSteerQueued={async () => false}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
