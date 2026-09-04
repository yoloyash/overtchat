import {
  agentProviderCreationDefaults,
  type AgentMode,
  type AgentModel,
  type AgentProviderCatalog,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import type { AgentProviderPreferences } from "./createPreferences";

export type AgentSessionDraftSelection = {
  model: AgentModel | null;
  thinkingOptionId: string;
  modeId: string;
  modes: AgentMode[];
};

export const AGENT_MODEL_DEFAULTS_LOADING_MESSAGE =
  "Model defaults are still loading";

export function newAgentSessionHref(
  workspaceId: string,
  provider: AgentProviderId,
): string {
  const query = new URLSearchParams({ workspaceId, provider });
  return `/agents/new?${query.toString()}`;
}

export function agentSessionDraftRestoreKey(sessionId: string): string {
  return `overtchat:agent-fork-draft:${sessionId}`;
}

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
  const model =
    models.find((candidate) => candidate.id === input.modelId) ??
    models.find((candidate) => candidate.id === input.preferences?.model) ??
    defaultModel(models);
  const rememberedThinking = model?.thinkingOptions?.find(
    (option) =>
      option.id === input.preferences?.thinkingByModel?.[model.id],
  )?.id;
  const thinkingOptionId =
    model?.thinkingOptions?.some(
      (option) => option.id === input.thinkingOptionId,
    )
      ? input.thinkingOptionId
      : (rememberedThinking ?? defaultThinking(model));
  const creationDefaults = agentProviderCreationDefaults(input.provider);
  const modes = [...(input.catalog?.modes ?? creationDefaults.modes)];
  const preferredMode = modes.find(
    (mode) => mode.id === input.preferences?.mode,
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

  return { model, thinkingOptionId, modeId, modes };
}
