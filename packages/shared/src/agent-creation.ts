import {
  agentProviderCreationDefaults,
  type AgentMode,
  type AgentModel,
  type AgentProviderCatalog,
  type AgentProviderId,
  type AgentProviderSnapshot,
} from "@overtchat/agent-bridge";

/** An agent a new session can start with in a folder. */
export type AgentWorkspaceAgent = {
  provider: AgentProviderId;
  /**
   * The folder record the session starts from. Until the agent has its own
   * record for the folder, another agent's record stands in; the server
   * creates the agent's own on launch.
   */
  workspaceId: string;
  /** False when the machine's last detection did not find the agent. */
  detected: boolean;
};

/**
 * The agents a new session can start with in a folder: the agents that have
 * a record of the folder, in the order given, then the rest of the machine's
 * agents as its last detection found them. Which agents a machine has is a
 * property of the machine, not of the folder: a folder added before an agent
 * was installed, or never used with it, still gets it. Without a detection
 * only the folder's own agents are known.
 */
export function agentWorkspaceAgents(
  own: ReadonlyArray<Pick<AgentWorkspaceAgent, "provider" | "workspaceId">>,
  snapshot: Pick<AgentProviderSnapshot, "providers"> | undefined,
): AgentWorkspaceAgent[] {
  const agents: AgentWorkspaceAgent[] = own.map(({ provider, workspaceId }) => ({
    provider,
    workspaceId,
    detected: true,
  }));
  const anchor = own[0];
  if (!anchor || !snapshot) return agents;
  const others = snapshot.providers.filter(
    (entry) => !own.some((agent) => agent.provider === entry.provider),
  );
  // Detected agents before the ones the machine does not have.
  for (const detected of [true, false]) {
    for (const entry of others) {
      if ((entry.status === "ready") !== detected) continue;
      agents.push({
        provider: entry.provider,
        workspaceId: anchor.workspaceId,
        detected,
      });
    }
  }
  return agents;
}
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
  const model =
    models.find((candidate) => candidate.id === input.modelId) ??
    models.find((candidate) => candidate.id === input.preferences?.model) ??
    defaultModel(models);
  const rememberedThinking = model?.thinkingOptions?.find(
    (option) => option.id === input.preferences?.thinkingByModel?.[model.id],
  )?.id;
  const thinkingOptionId = model?.thinkingOptions?.some(
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
