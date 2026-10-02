import {
  agentProviderCreationDefaults,
  type AgentMode,
  type AgentModel,
  type AgentProviderCatalog,
  type AgentProviderId,
  type AgentSessionLaunchConfig,
} from "@overtchat/agent-bridge";
type AgentProviderPreferences = {
  model?: string;
  mode?: string;
  thinkingByModel?: Record<string, string>;
};

export type AgentSessionDraftSelection = {
  model: AgentModel | null;
  thinkingOptionId: string;
  modeId: string;
  modes: AgentMode[];
  launchConfig: AgentSessionLaunchConfig;
};

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

export function resolveAgentSessionDraftSelection(input: {
  provider: AgentProviderId;
  catalog?: AgentProviderCatalog;
  preferences?: AgentProviderPreferences;
  modelId: string;
  thinkingOptionId: string;
  modeId: string;
}): AgentSessionDraftSelection {
  const models = input.catalog?.models ?? [];
  // Codex resolves omitted settings from its current config on the execution host.
  // Old browser preferences are not an explicit choice for a new thread.
  const preferences = input.provider === "codex" ? undefined : input.preferences;
  const model =
    models.find((candidate) => candidate.id === input.modelId) ??
    models.find((candidate) => candidate.id === preferences?.model) ??
    defaultModel(models);
  const rememberedThinking = model?.thinkingOptions?.find(
    (option) => option.id === preferences?.thinkingByModel?.[model.id],
  )?.id;
  const thinkingOptionId = model?.thinkingOptions?.some(
    (option) => option.id === input.thinkingOptionId,
  )
    ? input.thinkingOptionId
    : (rememberedThinking ?? defaultThinking(model));
  const creationDefaults = agentProviderCreationDefaults(input.provider);
  const modes = [...(input.catalog?.modes ?? creationDefaults.modes)];
  const preferredMode = modes.find(
    (mode) => mode.id === preferences?.mode,
  )?.id;
  const catalogDefaultMode = modes.find(
    (mode) => mode.id === input.catalog?.defaultModeId,
  )?.id;
  const staticDefaultMode = modes.find(
    (mode) => mode.id === creationDefaults.defaultModeId,
  )?.id;
  const modeId =
    modes.find((mode) => mode.id === input.modeId)?.id ??
    preferredMode ??
    catalogDefaultMode ??
    staticDefaultMode ??
    modes[0]?.id ??
    "";

  const launchConfig: AgentSessionLaunchConfig = input.provider === "codex"
    ? {
        ...(input.modelId ? { model: input.modelId } : {}),
        ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
        ...(input.modeId ? { modeId: input.modeId } : {}),
      }
    : {
        ...(model ? { model: model.id } : {}),
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
        ...(modeId ? { modeId } : {}),
      };
  return { model, thinkingOptionId, modeId, modes, launchConfig };
}
