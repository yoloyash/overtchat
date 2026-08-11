import type {
  AgentCollaborationMode,
  AgentConnectionDraft,
  AgentGoal,
  AgentModel,
  AgentPromptImage,
  AgentProviderSessionMetadata,
  AgentProviderId,
  AgentReadyConnectionProbe,
  AgentRuntimeEnvelope,
  AgentSessionCommand,
  AgentSessionStats,
  AgentSlashCommand,
  AgentThinkingLevel,
  AgentInteractionValue,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";

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
  detectedVersion?: string | null;
  resume?: {
    providerSessionId: string;
    providerSessionPath: string;
  };
};

export type AgentSessionForkResult = {
  session: AgentProviderSessionMetadata;
  draft?: string;
};

export type ResolvedAgentImage = AgentPromptImage & {
  data: string;
};

export type AgentSubmissionOptions = {
  clientMessageId?: string;
};

export interface AgentRuntimeClient {
  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void;
  getState(timeoutMs?: number): Promise<Record<string, unknown>>;
  getMessages(): Promise<{ messages: unknown[] }>;
  getAvailableModels(timeoutMs?: number): Promise<AgentModel[]>;
  getSessionStats(): Promise<AgentSessionStats>;
  getAvailableThinkingLevels(): Promise<AgentThinkingLevel[]>;
  getCommands(): Promise<AgentSlashCommand[]>;
  prompt(
    message: string,
    images?: readonly ResolvedAgentImage[],
    options?: AgentSubmissionOptions,
  ): Promise<unknown>;
  steer(
    message: string,
    images?: readonly ResolvedAgentImage[],
    options?: AgentSubmissionOptions,
  ): Promise<unknown>;
  abort(): Promise<unknown>;
  setModel(provider: string, modelId: string): Promise<unknown>;
  setThinkingLevel(level: string): Promise<unknown>;
  setCollaborationMode?(mode: AgentCollaborationMode): Promise<unknown>;
  setFastMode?(enabled: boolean): Promise<unknown>;
  updateGoal?(
    action: "set" | "pause" | "resume" | "clear",
    objective?: string,
  ): Promise<AgentGoal | null>;
  compact(customInstructions?: string): Promise<unknown>;
  setAutoCompaction(enabled: boolean): Promise<unknown>;
  setSessionName(name: string): Promise<unknown>;
  respondToInteraction(
    id: string,
    response: {
      value?: string;
      values?: Record<string, AgentInteractionValue>;
      confirmed?: boolean;
      cancelled?: boolean;
    },
  ): void;
  retryInteractive?(): Promise<unknown>;
  getUsage?(): Promise<AgentUsageSnapshot>;
  forkSession?(
    messageId: string,
    mode: "edit" | "fork",
  ): Promise<AgentSessionForkResult>;
  discardForkedSession?(session: AgentProviderSessionMetadata): Promise<void>;
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
    executable: string,
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
