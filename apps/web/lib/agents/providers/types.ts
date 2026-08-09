import type {
  AgentConnectionDraft,
  AgentModel,
  AgentProviderSessionMetadata,
  AgentProviderId,
  AgentReadyConnectionProbe,
  AgentRuntimeEnvelope,
  AgentSessionCommand,
  AgentSessionStats,
  AgentSlashCommand,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import type { HostTarget } from "@/lib/agents/runtime/process";

export type AgentRuntimeEvent = Extract<
  AgentRuntimeEnvelope,
  { type: "runtime_event" }
>["data"];

export type AgentRuntimeInitialState = {
  state: Record<string, unknown>;
  messages: unknown[];
  models: AgentModel[];
  thinkingLevels: AgentThinkingLevel[];
  commands: AgentSlashCommand[];
  stats: AgentSessionStats;
};

export type AgentSessionIdentity = {
  providerSessionId: string;
  providerSessionPath: string;
  sessionName: string | null;
};

export type AgentSessionLaunch = {
  executable: string;
  cwd: string;
  resume?: {
    providerSessionId: string;
    providerSessionPath: string;
  };
};

export interface AgentRuntimeClient {
  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void;
  getState(timeoutMs?: number): Promise<Record<string, unknown>>;
  getMessages(): Promise<{ messages: unknown[] }>;
  getAvailableModels(timeoutMs?: number): Promise<AgentModel[]>;
  getSessionStats(): Promise<AgentSessionStats>;
  getAvailableThinkingLevels(): Promise<AgentThinkingLevel[]>;
  getCommands(): Promise<AgentSlashCommand[]>;
  prompt(message: string): Promise<unknown>;
  steer(message: string): Promise<unknown>;
  abort(): Promise<unknown>;
  setModel(provider: string, modelId: string): Promise<unknown>;
  setThinkingLevel(level: string): Promise<unknown>;
  compact(customInstructions?: string): Promise<unknown>;
  setAutoCompaction(enabled: boolean): Promise<unknown>;
  setSessionName(name: string): Promise<unknown>;
  respondToInteraction(
    id: string,
    response: {
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    },
  ): void;
  stop(): Promise<void>;
}

export type AgentRuntimeEventClassification = {
  started: boolean;
  terminal: boolean;
};

export interface AgentRuntimeEventClassifier {
  reset(): void;
  classify(event: AgentRuntimeEvent): AgentRuntimeEventClassification;
}

export interface AgentProviderAdapter {
  readonly provider: AgentProviderId;
  startSession(
    target: HostTarget,
    launch: AgentSessionLaunch,
  ): AgentRuntimeClient;
  probeConnection(
    draft: AgentConnectionDraft,
  ): Promise<AgentReadyConnectionProbe>;
  probeTarget(
    target: HostTarget,
    executable: string,
  ): Promise<AgentReadyConnectionProbe>;
  listWorkspaceSessions(
    target: HostTarget,
    workspacePath: string,
  ): Promise<AgentProviderSessionMetadata[]>;
  sessionIdentity(state: Record<string, unknown>): AgentSessionIdentity;
  createEventClassifier(): AgentRuntimeEventClassifier;
  commandsFromEvent(
    event: AgentRuntimeEvent,
  ): AgentSlashCommand[] | null;
  mergeCommands(
    discovered: readonly AgentSlashCommand[],
  ): AgentSlashCommand[];
  normalizeCommand(
    command: AgentSessionCommand,
    state: Record<string, unknown>,
  ): AgentSessionCommand;
}
