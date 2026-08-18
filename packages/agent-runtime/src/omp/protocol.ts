import { z } from "zod";
import type {
  AgentModel,
  AgentSlashCommand,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@overtchat/agent-bridge";
import { AGENT_THINKING_LEVELS } from "@overtchat/agent-bridge";

const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  api: z.string().optional(),
  provider: z.string().min(1),
  baseUrl: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
  }).passthrough().optional(),
  thinking: z.object({
    efforts: z.array(z.string()).optional(),
    defaultLevel: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const commandsSchema = z.object({
  commands: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    source: z.enum(["builtin", "extension", "prompt", "skill", "custom", "mcp_prompt", "file"]),
    input: z.object({ hint: z.string().optional() }).optional(),
  }).passthrough()),
}).passthrough();

const statsSchema = z.object({
  sessionFile: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  userMessages: z.number().int().nonnegative().optional(),
  assistantMessages: z.number().int().nonnegative().optional(),
  toolCalls: z.number().int().nonnegative().optional(),
  toolResults: z.number().int().nonnegative().optional(),
  totalMessages: z.number().int().nonnegative().optional(),
  tokens: z.object({
    input: z.number().int().nonnegative().optional(),
    output: z.number().int().nonnegative().optional(),
    cacheRead: z.number().int().nonnegative().optional(),
    cacheWrite: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
  }).optional(),
  cost: z.number().nonnegative().optional(),
  contextUsage: z.object({
    tokens: z.number().int().nonnegative().nullable(),
    contextWindow: z.number().int().positive(),
    percent: z.number().nonnegative().nullable(),
  }).optional(),
}).passthrough();

const THINKING_COPY: Record<AgentThinkingLevel, { label: string; description: string }> = {
  off: { label: "Off", description: "No extra reasoning" },
  minimal: { label: "Minimal", description: "Light reasoning" },
  low: { label: "Low", description: "Faster reasoning" },
  medium: { label: "Medium", description: "Balanced reasoning" },
  high: { label: "High", description: "Deeper reasoning" },
  xhigh: { label: "XHigh", description: "Very deep reasoning" },
  max: { label: "Max", description: "Extreme reasoning" },
};

export function parseOmpModels(value: unknown): AgentModel[] {
  return z.object({ models: z.array(modelSchema) }).parse(value).models.map((model) => {
    const reported = model.thinking?.efforts;
    const filtered = reported?.length
      ? AGENT_THINKING_LEVELS.filter((level) => reported.includes(level))
      : [];
    const levels = filtered.length ? filtered : [...AGENT_THINKING_LEVELS];
    const requestedDefault = model.thinking?.defaultLevel as AgentThinkingLevel | undefined;
    const defaultThinkingOptionId =
      requestedDefault && levels.includes(requestedDefault)
        ? requestedDefault
        : filtered.length
          ? levels[0]
          : "medium";
    const thinkingOptions = model.reasoning
      ? levels.map((level) => ({
          id: level,
          ...THINKING_COPY[level],
          ...(level === defaultThinkingOptionId ? { isDefault: true } : {}),
        }))
      : [];
    return {
      provider: "omp",
      id: `${model.provider}/${model.id}`,
      label: displayModelLabel(model.name ?? model.id),
      description: `${model.provider}/${model.id}`,
      metadata: { provider: model.provider, modelId: model.id },
      api: model.api ?? "",
      baseUrl: model.baseUrl ?? "",
      reasoning: model.reasoning === true,
      input: (model.input ?? []).flatMap((input): Array<"text" | "image"> =>
        input === "text" || input === "image" ? [input] : [],
      ),
      contextWindow: model.contextWindow ?? null,
      maxTokens: model.maxTokens ?? model.contextWindow ?? null,
      ...(thinkingOptions.length ? { thinkingOptions } : {}),
      ...(thinkingOptions.length && defaultThinkingOptionId
        ? { defaultThinkingOptionId }
        : {}),
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cacheRead: model.cost?.cacheRead ?? 0,
        cacheWrite: model.cost?.cacheWrite ?? 0,
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

export function parseOmpCommands(value: unknown): AgentSlashCommand[] {
  return commandsSchema.parse(value).commands.map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source: command.source,
    ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
  }));
}

export function parseOmpStats(value: unknown): AgentSessionStats {
  const parsed = statsSchema.parse(value);
  const tokens = parsed.tokens;
  return {
    sessionFile: parsed.sessionFile ?? null,
    sessionId: parsed.sessionId ?? null,
    userMessages: parsed.userMessages ?? 0,
    assistantMessages: parsed.assistantMessages ?? 0,
    toolCalls: parsed.toolCalls ?? 0,
    toolResults: parsed.toolResults ?? 0,
    totalMessages: parsed.totalMessages ?? 0,
    tokens: {
      input: tokens?.input ?? 0,
      output: tokens?.output ?? 0,
      cacheRead: tokens?.cacheRead ?? 0,
      cacheWrite: tokens?.cacheWrite ?? 0,
      total: tokens?.total ?? 0,
    },
    cost: parsed.cost ?? 0,
    ...(parsed.contextUsage ? { contextUsage: parsed.contextUsage } : {}),
  };
}

export function mapOmpUiRequest(record: Record<string, unknown>): Record<string, unknown> {
  if (record.type !== "extension_ui_request") return record;
  const options = record.options;
  const title = typeof record.title === "string" ? record.title : "";
  const exactOptions =
    record.method === "select" &&
    Array.isArray(options) &&
    options.length === 2 &&
    options[0] === "Approve" &&
    options[1] === "Deny";
  if (!exactOptions) return { ...record, type: "interaction_request" };
  const firstBreak = title.search(/\r?\n/u);
  const heading = (firstBreak < 0 ? title : title.slice(0, firstBreak)).trim();
  if (!heading.startsWith("Allow tool: ")) {
    return { ...record, type: "interaction_request" };
  }
  const toolName = heading.slice("Allow tool: ".length).trim();
  const body = firstBreak < 0 ? "" : title.slice(firstBreak).replace(/^\r?\n/u, "");
  const detail = parseOmpToolApproval(toolName, body);
  if (!detail) return { ...record, type: "interaction_request" };
  return {
    ...record,
    type: "interaction_request",
    title: heading,
    message: detail.description,
    approvalKind: "tool",
    toolName,
    toolDetail: detail.value,
    approveValue: "Approve",
    denyValue: "Deny",
  };
}

function parseOmpToolApproval(
  toolName: string,
  body: string,
): { description: string; value: Record<string, unknown> } | null {
  if (toolName === "bash") {
    const command = /(?:^|\r?\n)[\t ]*Command:[\t ]?(.*)$/su.exec(body)?.[1];
    return command
      ? {
          description: `Command: ${command}`,
          value: { type: "shell", command },
        }
      : null;
  }
  const lines = body.split(/\r?\n/u);
  if (toolName === "edit") {
    const filePath = prefixedValue(lines, "File:");
    return filePath
      ? {
          description: `File: ${filePath}`,
          value: { type: "edit", filePath },
        }
      : null;
  }
  if (toolName === "write") {
    const pathIndex = lines.findIndex((line) => line.trim().startsWith("Path:"));
    const filePath =
      pathIndex < 0 ? null : stripPrefix(lines[pathIndex], "Path:")?.trim();
    const contentIndex = lines.findIndex(
      (line, index) => index > pathIndex && line.trim() === "Content:",
    );
    if (!filePath || contentIndex < 0) return null;
    const content = lines.slice(contentIndex + 1).join("\n");
    return {
      description: `Path: ${filePath}`,
      value: { type: "write", filePath, content },
    };
  }
  return null;
}

function prefixedValue(lines: readonly string[], prefix: string): string | null {
  for (const line of lines) {
    const value = stripPrefix(line, prefix)?.trim();
    if (value) return value;
  }
  return null;
}

function stripPrefix(line: string | undefined, prefix: string): string | null {
  const trimmed = line?.trim();
  return trimmed?.startsWith(prefix) ? trimmed.slice(prefix.length) : null;
}
