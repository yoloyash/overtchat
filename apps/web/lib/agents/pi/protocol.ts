import { z } from "zod";
import type {
  AgentModel,
  AgentProviderId,
  AgentSlashCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@/lib/agents/types";
import { AGENT_THINKING_LEVELS } from "@/lib/agents/types";

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
    name: z.string().min(1),
    api: z.string(),
    provider: z.string().min(1),
    baseUrl: z.string(),
    reasoning: z.boolean(),
    input: z.array(z.enum(["text", "image"])),
    contextWindow: z.number().int().positive().nullable().optional(),
    maxTokens: z.number().int().positive().nullable().optional(),
    cost: modelCostSchema,
  })
  .passthrough();

export const piModelSchema = rpcModelSchema.extend({
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
});

export const piModelsResponseSchema = z
  .object({ models: z.array(piModelSchema) })
  .passthrough();

const ompModelsResponseSchema = z
  .object({ models: z.array(rpcModelSchema) })
  .passthrough();

const thinkingLevelsResponseSchema = z
  .object({
    levels: z.array(z.enum(AGENT_THINKING_LEVELS)),
  })
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
  provider: AgentProviderId = "pi",
): AgentModel[] {
  const models =
    provider === "omp"
      ? ompModelsResponseSchema
          .parse(value)
          .models.filter(
            (model) =>
              typeof model.contextWindow === "number" &&
              model.contextWindow > 0,
          )
      : piModelsResponseSchema.parse(value).models;
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    api: model.api,
    provider: model.provider,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    input: model.input,
    contextWindow: model.contextWindow!,
    maxTokens: model.maxTokens ?? model.contextWindow!,
    cost: {
      input: model.cost.input,
      output: model.cost.output,
      cacheRead: model.cost.cacheRead,
      cacheWrite: model.cost.cacheWrite,
    },
  }));
}

export function parsePiThinkingLevels(value: unknown): AgentThinkingLevel[] {
  return thinkingLevelsResponseSchema.parse(value).levels;
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
