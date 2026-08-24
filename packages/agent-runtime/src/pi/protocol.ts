import { z } from "zod";
import type {
  AgentModel,
  AgentSlashCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@overtchat/agent-bridge";
import { AGENT_THINKING_LEVELS } from "@overtchat/agent-bridge";

const modelCostSchema = z
  .object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  })
  .passthrough();

const rpcModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    api: z.string().optional(),
    provider: z.string().min(1),
    baseUrl: z.string().optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.string()).optional(),
    contextWindow: z.number().int().positive().nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
    cost: modelCostSchema.optional(),
    thinking: z
      .object({
        efforts: z.array(z.string()).optional(),
        defaultLevel: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const piModelSchema = rpcModelSchema;

export const piModelsResponseSchema = z
  .object({ models: z.array(piModelSchema) })
  .passthrough();

const slashCommandsResponseSchema = z
  .object({
    commands: z.array(
      z
        .object({
          name: z.string().min(1),
          description: z.string().optional(),
          source: z.enum([
            "builtin",
            "extension",
            "prompt",
            "skill",
            "custom",
            "mcp_prompt",
            "file",
          ]),
          input: z
            .object({
              hint: z.string().optional(),
            })
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const sessionStatsSchema = z
  .object({
    sessionFile: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    userMessages: z.number().int().nonnegative().optional(),
    assistantMessages: z.number().int().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    toolResults: z.number().int().nonnegative().optional(),
    totalMessages: z.number().int().nonnegative().optional(),
    tokens: z
      .object({
        input: z.number().int().nonnegative().optional(),
        output: z.number().int().nonnegative().optional(),
        cacheRead: z.number().int().nonnegative().optional(),
        cacheWrite: z.number().int().nonnegative().optional(),
        total: z.number().int().nonnegative().optional(),
      })
      .optional(),
    cost: z.number().nonnegative().optional(),
    contextUsage: z
      .object({
        tokens: z.number().int().nonnegative().nullable(),
        contextWindow: z.number().int().positive(),
        percent: z.number().nonnegative().nullable(),
      })
      .optional(),
  })
  .passthrough();

export type PiRpcCommand = {
  type: string;
  [key: string]: unknown;
};

export type PiRpcEvent = {
  type: string;
  [key: string]: unknown;
};

export function parsePiModels(
  value: unknown,
): AgentModel[] {
  const models = piModelsResponseSchema.parse(value).models;
  return models.map((model) => {
    const options = model.reasoning
      ? thinkingOptionsForModel()
      : [];
    const defaultThinkingOptionId = options.find((option) => option.isDefault)?.id;
    const input = (model.input ?? []).flatMap((value): Array<"text" | "image"> =>
      value === "text" || value === "image" ? [value] : [],
    );
    const cost = model.cost;
    return {
      provider: "pi",
      id: `${model.provider}/${model.id}`,
      label: displayModelLabel(model.name ?? model.id),
      description: `${model.provider}/${model.id}`,
      metadata: { provider: model.provider, modelId: model.id },
      api: model.api ?? "",
      baseUrl: model.baseUrl ?? "",
      reasoning: model.reasoning === true,
      input,
      contextWindow: model.contextWindow ?? null,
      maxTokens: model.maxTokens ?? model.contextWindow ?? null,
      ...(options.length ? { thinkingOptions: options } : {}),
      ...(defaultThinkingOptionId ? { defaultThinkingOptionId } : {}),
      cost: {
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cacheRead: cost?.cacheRead ?? 0,
        cacheWrite: cost?.cacheWrite ?? 0,
      },
    };
  });
}

function displayModelLabel(name: string): string {
  const raw = name.split("/").filter(Boolean).at(-1) ?? name;
  const normalized = raw.trim().replace(/[_\s]+/gu, " ");
  const separator = normalized.indexOf(": ");
  return separator === -1
    ? normalized
    : normalized.slice(separator + 2).trim();
}

const THINKING_COPY: Record<
  AgentThinkingLevel,
  { label: string; description: string }
> = {
  off: { label: "Off", description: "No extra reasoning" },
  minimal: { label: "Minimal", description: "Light reasoning" },
  low: { label: "Low", description: "Faster reasoning" },
  medium: { label: "Medium", description: "Balanced reasoning" },
  high: { label: "High", description: "Deeper reasoning" },
  xhigh: { label: "XHigh", description: "Very deep reasoning" },
  max: { label: "Max", description: "Extreme reasoning" },
};

function thinkingOptionsForModel() {
  const levels = [...AGENT_THINKING_LEVELS];
  const defaultLevel: AgentThinkingLevel = "medium";
  return levels.map((level) => ({
    id: level,
    ...THINKING_COPY[level],
    ...(level === defaultLevel ? { isDefault: true } : {}),
  }));
}

export function parsePiCommands(value: unknown): AgentSlashCommand[] {
  return slashCommandsResponseSchema.parse(value).commands.map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source: command.source,
    ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
  }));
}

export function parsePiSessionStats(value: unknown): AgentSessionStats {
  const stats = sessionStatsSchema.parse(value);
  return {
    sessionFile: stats.sessionFile ?? null,
    sessionId: stats.sessionId ?? null,
    userMessages: stats.userMessages ?? 0,
    assistantMessages: stats.assistantMessages ?? 0,
    toolCalls: stats.toolCalls ?? 0,
    toolResults: stats.toolResults ?? 0,
    totalMessages: stats.totalMessages ?? 0,
    tokens: {
      input: stats.tokens?.input ?? 0,
      output: stats.tokens?.output ?? 0,
      cacheRead: stats.tokens?.cacheRead ?? 0,
      cacheWrite: stats.tokens?.cacheWrite ?? 0,
      total: stats.tokens?.total ?? 0,
    },
    cost: stats.cost ?? 0,
    ...(stats.contextUsage ? { contextUsage: stats.contextUsage } : {}),
  };
}
