"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Check, Loader2 } from "lucide-react";
import type {
  AgentModel,
  AgentProviderId,
  AgentSessionLaunchConfig,
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
import { AGENT_PROVIDER_VISUALS } from "@/lib/agents/providerVisuals";
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
  targets,
  machineLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: Array<{
    workspace: AgentWorkspaceListItem;
    provider: AgentProviderId;
    providerLabel: string;
  }>;
  machineLabel: string;
}) {
  const router = useRouter();
  const { closeMobile } = useSidebar();
  const [selectedProvider, setSelectedProvider] = useState<AgentProviderId | "">(
    "",
  );
  const selectedTarget =
    targets.length === 1
      ? targets[0]
      : targets.find((target) => target.provider === selectedProvider);
  const workspace = selectedTarget?.workspace ?? targets[0]!.workspace;
  const provider = selectedTarget?.provider;
  const providerLabel = selectedTarget?.providerLabel;
  const catalog = useAgentWorkspaceCatalog(
    selectedTarget?.workspace.id ?? null,
    selectedTarget?.provider ?? null,
    open && selectedTarget !== undefined,
  );
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
  const [thinkingOptionId, setThinkingOptionId] = useState("");
  const [modeId, setModeId] = useState("");
  const providerPreferences = provider
    ? preferences.providerPreferences?.[provider]
    : undefined;
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
      : (preferredThinking ?? defaultThinking(selectedModel));
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
    if (!provider) return;
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
    setThinkingOptionId(thinking);
    updateProviderPreferences({ model: model.id });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedTarget || !provider || !effectiveModelId) return;
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
        workspaceId: selectedTarget.workspace.id,
        provider,
        launchConfig,
      });
      closeDialog();
      closeMobile();
      router.push(`/agents/${id}`);
    } catch (cause) {
      toast.error({
        title: `Failed to start ${providerLabel ?? "agent"}`,
        description:
          cause instanceof Error
            ? cause.message
            : "A new session could not be started.",
      });
    }
  }

  const loading = catalog.isFetching && !catalog.data;
  const error = catalog.error instanceof Error ? catalog.error.message : null;

  function selectAgent(nextProvider: AgentProviderId) {
    setSelectedProvider(nextProvider);
    setModelId("");
    setThinkingOptionId("");
    setModeId("");
  }

  function closeDialog() {
    setSelectedProvider("");
    setModelId("");
    setThinkingOptionId("");
    setModeId("");
    createSession.reset();
    onOpenChange(false);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (createSession.isPending) return;
        if (next) onOpenChange(true);
        else closeDialog();
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
            New session in {workspace.name}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{workspace.path}</span>
            <span aria-hidden="true"> · </span>
            {machineLabel}
          </Dialog.Description>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label>{targets.length > 1 ? "Choose an agent" : "Agent"}</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {targets.map((target) => {
                  const selected = target.provider === selectedTarget?.provider;
                  const icon = AGENT_PROVIDER_VISUALS[target.provider];
                  return (
                    <button
                      key={target.provider}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`Select ${target.providerLabel}`}
                      onClick={() => selectAgent(target.provider)}
                      className={cn(
                        "flex min-h-16 items-center gap-3 rounded-lg border p-3 text-left outline-none motion-colors hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50",
                        selected && "border-primary bg-primary/5 ring-1 ring-primary",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-md border bg-background",
                          icon.darkSurface && "bg-zinc-950",
                        )}
                      >
                        <Image
                          src={icon.icon}
                          alt=""
                          className="size-5 object-contain"
                        />
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium">
                        {target.providerLabel}
                      </span>
                      {selected && <Check className="size-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {!selectedTarget ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Choose an agent to configure this session.
              </p>
            ) : loading ? (
              <div className="flex min-h-40 items-center justify-center rounded-lg border">
                <Loader2
                  className={cn(
                    "size-5 text-muted-foreground",
                    motionClasses.spinner,
                  )}
                />
              </div>
            ) : error ? (
              <div className="space-y-4 rounded-lg border p-4">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void catalog.refetch()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <div className="space-y-4 border-t pt-4">
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
                      setThinkingOptionId(value);
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
              </div>
            )}

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={createSession.isPending}
                onClick={closeDialog}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  !selectedTarget ||
                  !effectiveModelId ||
                  createSession.isPending
                }
              >
                {createSession.isPending ? "Starting…" : "Start session"}
              </Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
