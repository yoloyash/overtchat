import { z } from "zod";

export const AGENT_PROVIDER_IDS = ["pi", "omp"] as const;
export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

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

const connectionBaseSchema = z.object({
  provider: z.enum(AGENT_PROVIDER_IDS),
  name: z.string().trim().min(1).max(80),
  executable: z.string().trim().min(1).max(500),
});

export const localConnectionDraftSchema = connectionBaseSchema.extend({
  transport: z.literal("local"),
});

export const sshConnectionDraftSchema = connectionBaseSchema.extend({
  transport: z.literal("ssh"),
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9._:-]+$/, "Enter a valid hostname or IP address."),
  port: z.number().int().min(1).max(65_535).default(22),
  username: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9._-]+$/, "Enter a valid SSH username."),
  sshAuth: z.enum(["agent", "private_key"]).default("agent"),
  privateKey: z.string().max(32_768).optional(),
  hostKey: z.string().max(16_384).optional(),
});

export const agentConnectionDraftSchema = z.discriminatedUnion("transport", [
  localConnectionDraftSchema,
  sshConnectionDraftSchema,
]);

export type AgentConnectionDraft = z.infer<
  typeof agentConnectionDraftSchema
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
};

export type AgentWorkspaceListItem = {
  id: string;
  path: string;
  name: string;
  sessions: AgentSessionListItem[];
};

export type AgentConnectionListItem = {
  id: string;
  provider: AgentProviderId;
  executable: string;
  detectedVersion: string | null;
  lastValidatedAt: number | null;
  host: {
    id: string;
    name: string;
    transport: AgentTransportId;
    hostname: string | null;
    port: number | null;
    username: string | null;
    sshAuth: "agent" | "private_key" | null;
  };
  workspaces: AgentWorkspaceListItem[];
};

export type AgentModel = {
  id: string;
  name: string;
  provider: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type AgentReadyConnectionProbe = {
  status: "ready";
  version: string;
  models: AgentModel[];
};

export type AgentHostKeyProbe = {
  status: "host_key";
  hostKey: string;
  hostKeyFingerprint: string;
};

export type AgentConnectionProbe =
  | AgentReadyConnectionProbe
  | AgentHostKeyProbe;

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

export const agentSessionCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    message: z.string().trim().min(1).max(200_000),
    streamingBehavior: z.enum(["steer", "followUp"]).optional(),
  }),
  z.object({ type: z.literal("abort") }),
  z.object({
    type: z.literal("set_model"),
    provider: z.string().trim().min(1).max(120),
    modelId: z.string().trim().min(1).max(500),
  }),
  z.object({
    type: z.literal("set_thinking_level"),
    level: z.enum(AGENT_THINKING_LEVELS),
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
  z.object({
    type: z.literal("extension_ui_response"),
    id: z.string().min(1).max(500),
    value: z.string().max(200_000).optional(),
    confirmed: z.boolean().optional(),
    cancelled: z.boolean().optional(),
  }),
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
  status: "idle" | "running" | "exited";
  state: Record<string, unknown>;
  messages: unknown[];
  models: AgentModel[];
  thinkingLevels: AgentThinkingLevel[];
  commands: AgentSlashCommand[];
  stats: AgentSessionStats;
  pendingExtensionRequest?: {
    type: "extension_ui_request";
    id: string;
    method: string;
    [key: string]: unknown;
  };
  error?: string;
};

export type AgentRuntimeEnvelope =
  | {
      sequence: number;
      type: "snapshot";
      data: AgentRuntimeSnapshot;
    }
  | {
      sequence: number;
      type: "pi_event";
      data: {
        type: string;
        [key: string]: unknown;
      };
    };
