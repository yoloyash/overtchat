"use client";

import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import type {
  AgentModel,
  AgentProviderId,
  AgentSessionLaunchConfig,
  AgentThinkingLevel,
  AgentWorkspaceListItem,
} from "@overtchat/agent-bridge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useSidebar } from "@/components/sidebar-context";
import { motionClasses } from "@/lib/motion";
import {
  AGENT_CREATE_PREFERENCES_KEY,
  DEFAULT_AGENT_CREATE_PREFERENCES,
  mergeAgentProviderPreferences,
  parseAgentCreatePreferences,
} from "@/lib/agents/createPreferences";
import {
  useAgentWorkspaceCatalog,
  useCreateAgentSession,
} from "@/lib/queries/agentConnections";
import { useLocalStorage } from "@/lib/useLocalStorage";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

function defaultModel(models: AgentModel[]): AgentModel | null {
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

function defaultThinking(model: AgentModel | null): string {
  if (!model) return "";
  return (
    model.defaultThinkingOptionId ??
    model.thinkingOptions?.find((option) => option.isDefault)?.id ??
    model.thinkingOptions?.[0]?.id ??
    ""
  );
}

export function NewAgentSessionDialog({
  open,
  onOpenChange,
  workspace,
  provider,
  providerLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: AgentWorkspaceListItem;
  provider: AgentProviderId;
  providerLabel: string;
}) {
  const router = useRouter();
  const { closeMobile } = useSidebar();
  const catalog = useAgentWorkspaceCatalog(workspace.id, open);
  const createSession = useCreateAgentSession();
  const [storedPreferences, setPreferences] = useLocalStorage<unknown>(
    AGENT_CREATE_PREFERENCES_KEY,
    DEFAULT_AGENT_CREATE_PREFERENCES,
  );
  const preferences = useMemo(
    () => parseAgentCreatePreferences(storedPreferences),
    [storedPreferences],
  );
  const [modelId, setModelId] = useState("");
  const [thinkingOptionId, setThinkingOptionId] = useState<AgentThinkingLevel | "">("");
  const [modeId, setModeId] = useState("");
  const providerPreferences = preferences.providerPreferences?.[provider];
  const selectedModel = useMemo(
    () => {
      const models = catalog.data?.models ?? [];
      return (
        models.find((model) => model.id === modelId) ??
        models.find((model) => model.id === providerPreferences?.model) ??
        defaultModel(models)
      );
    },
    [catalog.data?.models, modelId, providerPreferences?.model],
  );
  const effectiveModelId = selectedModel?.id ?? "";
  const preferredThinking = selectedModel?.thinkingOptions?.find(
    (option) =>
      option.id === providerPreferences?.thinkingByModel?.[selectedModel.id],
  )?.id;
  const effectiveThinkingOptionId =
    selectedModel?.thinkingOptions?.some(
      (option) => option.id === thinkingOptionId,
    )
      ? thinkingOptionId
      : ((preferredThinking ?? defaultThinking(selectedModel)) as
          | AgentThinkingLevel
          | "");
  const preferredMode = catalog.data?.modes.find(
    (mode) => mode.id === providerPreferences?.mode,
  )?.id;
  const effectiveModeId =
    (catalog.data?.modes.some((mode) => mode.id === modeId) ? modeId : "") ||
    preferredMode ||
    catalog.data?.defaultModeId ||
    catalog.data?.modes[0]?.id ||
    "";

  function updateProviderPreferences(
    update: Parameters<typeof mergeAgentProviderPreferences>[0]["updates"],
  ) {
    setPreferences(
      mergeAgentProviderPreferences({ preferences, provider, updates: update }),
    );
  }

  function selectModel(nextModelId: string | null) {
    if (!nextModelId || !catalog.data) return;
    const model = catalog.data.models.find((candidate) => candidate.id === nextModelId);
    if (!model) return;
    const remembered = providerPreferences?.thinkingByModel?.[model.id];
    const thinking =
      model.thinkingOptions?.some((option) => option.id === remembered)
        ? remembered!
        : defaultThinking(model);
    setModelId(model.id);
    setThinkingOptionId(thinking as AgentThinkingLevel | "");
    updateProviderPreferences({ model: model.id });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!effectiveModelId) return;
    const launchConfig: AgentSessionLaunchConfig = {
      model: effectiveModelId,
      ...(effectiveThinkingOptionId
        ? { thinkingOptionId: effectiveThinkingOptionId }
        : {}),
      ...(effectiveModeId ? { modeId: effectiveModeId } : {}),
    };
    setPreferences(
      mergeAgentProviderPreferences({
        preferences,
        provider,
        updates: {
          model: effectiveModelId,
          ...(effectiveModeId ? { mode: effectiveModeId } : {}),
          ...(effectiveThinkingOptionId
            ? {
                thinkingByModel: {
                  [effectiveModelId]: effectiveThinkingOptionId,
                },
              }
            : {}),
        },
      }),
    );
    try {
      const id = await createSession.mutateAsync({
        workspaceId: workspace.id,
        launchConfig,
      });
      onOpenChange(false);
      closeMobile();
      router.push(`/agents/${id}`);
    } catch (cause) {
      toast.error({
        title: `Failed to start ${providerLabel}`,
        description:
          cause instanceof Error
            ? cause.message
            : "A new session could not be started.",
      });
    }
  }

  const loading = catalog.isFetching && !catalog.data;
  const error = catalog.error instanceof Error ? catalog.error.message : null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!createSession.isPending) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className={cn("fixed inset-0 z-40 bg-black/40", motionClasses.overlay)}
        />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg outline-none",
            motionClasses.dialog,
          )}
        >
          <Dialog.Title className="text-lg font-semibold tracking-tight">
            New {providerLabel} session
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Choose how {providerLabel} starts in {workspace.name}.
          </Dialog.Description>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center">
              <Loader2 className={cn("size-5 text-muted-foreground", motionClasses.spinner)} />
            </div>
          ) : error ? (
            <div className="mt-5 space-y-4">
              <p className="text-sm text-destructive">{error}</p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={() => void catalog.refetch()}>
                  Try again
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`agent-model-${workspace.id}`}>Model</Label>
                <Select value={effectiveModelId} onValueChange={selectModel}>
                  <SelectTrigger id={`agent-model-${workspace.id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.data?.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span className="min-w-0">
                          <span className="block truncate">{model.label}</span>
                          {model.description && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {model.description}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(selectedModel?.thinkingOptions?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`agent-thinking-${workspace.id}`}>Reasoning</Label>
                  <Select
                    value={effectiveThinkingOptionId}
                    onValueChange={(value) => {
                      if (!value || !selectedModel) return;
                      setThinkingOptionId(value as AgentThinkingLevel);
                      updateProviderPreferences({
                        thinkingByModel: {
                          ...providerPreferences?.thinkingByModel,
                          [selectedModel.id]: value,
                        },
                      });
                    }}
                  >
                    <SelectTrigger id={`agent-thinking-${workspace.id}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedModel?.thinkingOptions?.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(catalog.data?.modes.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor={`agent-mode-${workspace.id}`}>Permissions</Label>
                  <Select
                    value={effectiveModeId}
                    onValueChange={(value) => {
                      if (!value) return;
                      setModeId(value);
                      updateProviderPreferences({ mode: value });
                    }}
                  >
                    <SelectTrigger id={`agent-mode-${workspace.id}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {catalog.data?.modes.map((mode) => (
                        <SelectItem key={mode.id} value={mode.id}>
                          <span className="min-w-0">
                            <span className="block truncate">{mode.label}</span>
                            {mode.description && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {mode.description}
                              </span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t pt-4">
                <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!effectiveModelId || createSession.isPending}>
                  {createSession.isPending ? "Starting…" : "Start session"}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
