import { z } from "zod";

export const CONNECTOR_SHELL_MODES = ["interactive", "login"] as const;
export type ConnectorShellMode = (typeof CONNECTOR_SHELL_MODES)[number];

export const AGENT_PROVIDER_IDS = ["pi", "omp", "codex"] as const;
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];
export type AgentRuntimeStatus = "idle" | "running" | "exited";

export const AGENT_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

export const AGENT_TRANSPORT_IDS = ["local", "ssh"] as const;
export type AgentTransportId = (typeof AGENT_TRANSPORT_IDS)[number];

const connectorIdSchema = z.string().min(1).max(128);
const sshAliasSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?!-)[a-zA-Z0-9._-]+$/, "Enter a valid SSH host alias.");

const connectionBaseSchema = z.object({
  connectorId: connectorIdSchema,
  provider: z.enum(AGENT_PROVIDER_IDS),
  name: z.string().trim().min(1).max(80),
  executable: z.string().trim().min(1).max(500),
});

export const localConnectionDraftSchema = connectionBaseSchema.extend({
  transport: z.literal("local"),
});

export const sshConnectionDraftSchema = connectionBaseSchema.extend({
  transport: z.literal("ssh"),
  sshAlias: sshAliasSchema,
});

export const agentConnectionDraftSchema = z.discriminatedUnion("transport", [
  localConnectionDraftSchema,
  sshConnectionDraftSchema,
]);

export const agentDiscoveryTargetSchema = z.discriminatedUnion("transport", [
  z.object({
    connectorId: connectorIdSchema,
    transport: z.literal("local"),
  }),
  z.object({
    connectorId: connectorIdSchema,
    transport: z.literal("ssh"),
    sshAlias: sshAliasSchema,
  }),
]);

export type AgentConnectionDraft = z.infer<
  typeof agentConnectionDraftSchema
>;
export type AgentDiscoveryTarget = z.infer<
  typeof agentDiscoveryTargetSchema
>;
export type LocalConnectionDraft = z.infer<typeof localConnectionDraftSchema>;
export type SshConnectionDraft = z.infer<typeof sshConnectionDraftSchema>;

export const addAgentWorkspaceSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(4_096)
    .refine((value) => value.startsWith("/"), {
      message: "Enter an absolute directory path.",
    }),
  name: z.string().trim().min(1).max(120).optional(),
});

export type AddAgentWorkspaceInput = z.infer<
  typeof addAgentWorkspaceSchema
>;

export type AgentSessionListItem = {
  id: string;
  providerSessionId: string;
  name: string | null;
  firstMessage: string | null;
  messageCount: number;
  createdAt: number | null;
  modifiedAt: number | null;
  runtimeStatus: AgentRuntimeStatus;
};

export type AgentProviderSessionMetadata = {
  providerSessionId: string;
  providerSessionPath: string;
  name: string | null;
  firstMessage: string | null;
  messageCount: number;
  createdAt: Date | null;
  modifiedAt: Date | null;
  launchConfig?: AgentSessionLaunchConfig;
};

export type AgentWorkspaceListItem = {
  id: string;
  path: string;
  name: string;
  sessions: AgentSessionListItem[];
};

export type AgentWorkspaceGitStatus = {
  isGit: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  changedFiles: number;
  additions: number;
  deletions: number;
  lineStatsComplete: boolean;
};

export type AgentConnectionListItem = {
  id: string;
  provider: AgentProviderId;
  executable: string;
  detectedVersion: string | null;
  lastValidatedAt: number | null;
  host: {
    id: string;
    connectorId: string;
    name: string;
    transport: AgentTransportId;
    sshAlias: string | null;
  };
  workspaces: AgentWorkspaceListItem[];
};

export type HostConnectorListItem = {
  id: string;
  name: string;
  managed: boolean;
  version: string | null;
  lastSeenAt: number | null;
  online: boolean;
  upgrade: {
    version: string;
    command: string;
  } | null;
};

export type HostConnectorPairing = {
  pairCode: string;
  expiresAt: number;
  command: string;
};

export type AgentModel = {
  provider: AgentProviderId;
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  metadata?: {
    provider?: string;
    modelId?: string;
  };
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number | null;
  maxTokens: number | null;
  thinkingOptions?: AgentSelectOption[];
  defaultThinkingOptionId?: AgentThinkingLevel;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type AgentSelectOption = {
  id: AgentThinkingLevel;
  label: string;
  description?: string;
  isDefault?: boolean;
};

export const agentSessionLaunchConfigSchema = z
  .object({
    model: z.string().trim().min(1).max(500).optional(),
    thinkingOptionId: z.enum(AGENT_THINKING_LEVELS).optional(),
    modeId: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export type AgentSessionLaunchConfig = z.infer<
  typeof agentSessionLaunchConfigSchema
>;

export type AgentProviderNotice = {
  type: "info" | "warning";
  message: string;
};

export function isAgentProviderNotice(value: unknown): value is AgentProviderNotice {
  return (
    value !== null &&
    typeof value === "object" &&
    (Reflect.get(value, "type") === "info" ||
      Reflect.get(value, "type") === "warning") &&
    typeof Reflect.get(value, "message") === "string"
  );
}

export type AgentReadyConnectionProbe = {
  status: "ready";
  version: string;
  models: AgentModel[];
  shellMode: ConnectorShellMode;
};

export type AgentConnectionProbe = AgentReadyConnectionProbe;

export type DetectedAgentInstallation = {
  provider: AgentProviderId;
  executable: string;
  version: string;
};

export type AgentSshHostCandidate = {
  alias: string;
  hostname: string;
  port: number;
  username: string;
};

export type AgentDirectoryListing = {
  path: string;
  parent: string | null;
  directories: Array<{
    name: string;
    path: string;
  }>;
};

export type AgentSlashCommand = {
  name: string;
  description?: string;
  source:
    | "builtin"
    | "extension"
    | "prompt"
    | "skill"
    | "custom"
    | "mcp_prompt"
    | "file";
  argumentHint?: string;
};

export const AGENT_IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const MAX_AGENT_IMAGES = 4;
export const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AGENT_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;

export const agentPromptImageSchema = z.object({
  uploadId: z.string().uuid(),
  filename: z.string().trim().min(1).max(500),
  mediaType: z.enum(AGENT_IMAGE_MEDIA_TYPES),
});

export type AgentPromptImage = z.infer<typeof agentPromptImageSchema>;

export type AgentQueuedMessage = {
  id: string;
  message: string;
  images?: AgentPromptImage[];
  status: "pending" | "sending" | "uncertain";
};

export type AgentInteractionValue =
  | string
  | number
  | boolean
  | string[];

export type AgentRuntimeCapabilities = {
  steer: boolean;
  customCompactionInstructions?: boolean;
  usage?: boolean;
  editSentMessages?: boolean;
  forkMessages?: boolean;
};

export const AGENT_COLLABORATION_MODES = ["default", "plan"] as const;
export type AgentCollaborationMode =
  (typeof AGENT_COLLABORATION_MODES)[number];

export type AgentMode = {
  id: string;
  label: string;
  description: string;
  dangerous?: boolean;
};

export type AgentProviderCatalog = {
  provider: AgentProviderId;
  models: AgentModel[];
  modes: AgentMode[];
  defaultModeId?: string | null;
};

const agentSelectOptionSchema = z.object({
  id: z.enum(AGENT_THINKING_LEVELS),
  label: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
});

const agentModelSchema = z.object({
  provider: z.enum(AGENT_PROVIDER_IDS),
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  metadata: z
    .object({
      provider: z.string().optional(),
      modelId: z.string().optional(),
    })
    .optional(),
  api: z.string(),
  baseUrl: z.string(),
  reasoning: z.boolean(),
  input: z.array(z.enum(["text", "image"])),
  contextWindow: z.number().int().positive().nullable(),
  maxTokens: z.number().int().positive().nullable(),
  thinkingOptions: z.array(agentSelectOptionSchema).optional(),
  defaultThinkingOptionId: z.enum(AGENT_THINKING_LEVELS).optional(),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  }),
});

const agentModeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  dangerous: z.boolean().optional(),
});

export const agentProviderCatalogSchema = z
  .object({
    provider: z.enum(AGENT_PROVIDER_IDS),
    models: z.array(agentModelSchema).min(1),
    modes: z.array(agentModeSchema),
    defaultModeId: z.string().min(1).nullable().optional(),
  })
  .superRefine((catalog, context) => {
    for (const [index, model] of catalog.models.entries()) {
      if (model.provider !== catalog.provider) {
        context.addIssue({
          code: "custom",
          path: ["models", index, "provider"],
          message: "Model provider must match the catalog provider.",
        });
      }
    }
    if (
      catalog.defaultModeId &&
      !catalog.modes.some((mode) => mode.id === catalog.defaultModeId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultModeId"],
        message: "Default mode must be present in the catalog.",
      });
    }
  });

export const AGENT_GOAL_STATUSES = [
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
] as const;
export type AgentGoalStatus = (typeof AGENT_GOAL_STATUSES)[number];

export type AgentGoal = {
  objective: string;
  status: AgentGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type AgentUsageWindow = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  windowDurationMins: number | null;
};

export type AgentUsageSnapshot = {
  planType: string | null;
  windows: AgentUsageWindow[];
  credits: {
    balance: string | null;
    unlimited: boolean;
  } | null;
  activity: {
    lifetimeTokens: number | null;
    currentStreakDays: number | null;
    longestStreakDays: number | null;
    peakDailyTokens: number | null;
  } | null;
  unavailableReason: string | null;
};

const clientMessageIdSchema = z.string().min(1).max(500).optional();

export const agentSessionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    message: z.string().trim().max(200_000),
    images: z.array(agentPromptImageSchema).max(MAX_AGENT_IMAGES).optional(),
    clientMessageId: clientMessageIdSchema,
  }),
  z.object({ type: z.literal("abort") }),
  z.object({
    type: z.literal("queue"),
    message: z.string().trim().max(200_000),
    images: z.array(agentPromptImageSchema).max(MAX_AGENT_IMAGES).optional(),
    clientMessageId: clientMessageIdSchema,
  }),
  z.object({
    type: z.literal("remove_queued_message"),
    id: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("steer_queued_message"),
    id: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("set_model"),
    modelId: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal("set_thinking_level"),
    level: z.enum(AGENT_THINKING_LEVELS),
  }),
  z.object({
    type: z.literal("set_collaboration_mode"),
    mode: z.enum(AGENT_COLLABORATION_MODES),
  }),
  z.object({
    type: z.literal("set_fast_mode"),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("set_mode"),
    modeId: z.string().trim().min(1).max(120),
  }),
  z.object({
    type: z.literal("update_goal"),
    action: z.enum(["set", "pause", "resume", "clear"]),
    objective: z.string().trim().min(1).max(20_000).optional(),
  }),
  z.object({
    type: z.literal("implement_plan"),
    plan: z.string().trim().max(100_000),
    clientMessageId: clientMessageIdSchema,
  }),
  z.object({
    type: z.literal("compact"),
    customInstructions: z.string().trim().max(20_000).optional(),
  }),
  z.object({
    type: z.literal("set_auto_compaction"),
    enabled: z.boolean(),
  }),
  z.object({
    type: z.literal("set_session_name"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({ type: z.literal("new_session") }),
  z.object({ type: z.literal("show_usage") }),
  z.object({
    type: z.literal("edit_message"),
    messageId: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("fork_message"),
    messageId: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal("interaction_response"),
    id: z.string().min(1).max(500),
    value: z.string().max(200_000).optional(),
    values: z
      .record(
        z.string().min(1).max(500),
        z.union([
          z.string().max(200_000),
          z.number().finite(),
          z.boolean(),
          z.array(z.string().max(20_000)).max(500),
        ]),
      )
      .optional(),
    confirmed: z.boolean().optional(),
    cancelled: z.boolean().optional(),
  }),
  z.object({ type: z.literal("retry_interactive") }),
]);

export type AgentSessionCommand = z.infer<typeof agentSessionCommandSchema>;

export type AgentSessionStats = {
  sessionFile: string | null;
  sessionId: string | null;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  };
};

export type AgentRuntimeSnapshot = {
  sessionId: string;
  provider: AgentProviderId;
  capabilities: AgentRuntimeCapabilities;
  status: AgentRuntimeStatus;
  activeTurn: {
    startedAt: number;
  } | null;
  state: Record<string, unknown>;
  messages: unknown[];
  models: AgentModel[];
  commands: AgentSlashCommand[];
  stats: AgentSessionStats;
  queuedMessages: AgentQueuedMessage[];
  readOnly?: {
    reason: string;
    retryable: boolean;
  };
  pendingInteraction?: {
    type: "interaction_request";
    id: string;
    method: string;
    [key: string]: unknown;
  };
  error?: string;
};

export type AgentRuntimeEnvelope =
  | {
      epoch: string;
      sequence: number;
      type: "snapshot";
      data: AgentRuntimeSnapshot;
    }
  | {
      epoch: string;
      sequence: number;
      type: "runtime_event";
      data: {
        type: string;
        [key: string]: unknown;
      };
    };

export type AgentRuntimeCursor = {
  epoch: string;
  sequence: number;
};

/**
 * An authoritative point-in-time reconciliation result owned by the Host
 * Connector. Reset snapshots are deliberately not runtime envelopes: reading
 * current state must not consume a sequence number that other subscribers can
 * never observe.
 */
export type AgentSessionSync =
  | {
      reset: true;
      cursor: AgentRuntimeCursor;
      snapshot: AgentRuntimeSnapshot;
    }
  | {
      reset: false;
      cursor: AgentRuntimeCursor;
      events: AgentRuntimeEnvelope[];
    };
