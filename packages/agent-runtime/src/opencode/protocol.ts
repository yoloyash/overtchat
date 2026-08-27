import type {
  AgentModel,
  AgentMode,
  AgentProviderSessionMetadata,
  AgentSessionStats,
  AgentSlashCommand,
} from "@overtchat/agent-bridge";
import type {
  Agent,
  Command,
  Message,
  Part,
  Provider,
  Session,
} from "@opencode-ai/sdk/v2/client";

export type OpenCodeMessageWithParts = {
  info: Message;
  parts: Part[];
};

export function openCodeErrorText(value: unknown): string {
  if (!value) return "OpenCode returned an unknown error.";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const data = Reflect.get(value, "data");
    if (data && typeof data === "object") {
      const message = Reflect.get(data, "message");
      if (typeof message === "string" && message) return message;
    }
    const message = Reflect.get(value, "message");
    if (typeof message === "string" && message) return message;
    const name = Reflect.get(value, "name");
    if (typeof name === "string" && name) return name;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseOpenCodeModels(data: {
  all: Provider[];
  connected: string[];
  default: Record<string, string>;
}, configuredModel?: string): AgentModel[] {
  const connected = new Set(data.connected);
  return data.all.flatMap((provider) => {
    if (!connected.has(provider.id) && provider.source !== "api") return [];
    return Object.entries(provider.models).map(([modelId, model]) => {
      const variantIds = Object.keys(model.variants ?? {}).filter(
        (id) => id !== "default",
      );
      const thinkingOptions = variantIds.length
        ? [
            { id: "default", label: "Default", isDefault: true },
            ...variantIds.map((id) => ({ id, label: id })),
          ]
        : undefined;
      const input: Array<"text" | "image"> = ["text"];
      if (model.capabilities.input.image || model.capabilities.attachment) {
        input.push("image");
      }
      return {
        provider: "opencode" as const,
        id: `${provider.id}/${modelId}`,
        label: model.name,
        description: [provider.name, model.family].filter(Boolean).join(" · "),
        isDefault: configuredModel
          ? configuredModel === `${provider.id}/${modelId}`
          : data.default[provider.id] === modelId,
        metadata: { provider: provider.id, modelId },
        api: model.api.id,
        baseUrl: model.api.url,
        reasoning: model.capabilities.reasoning,
        input,
        contextWindow: model.limit.context || null,
        maxTokens: model.limit.output || null,
        ...(thinkingOptions ? { thinkingOptions, defaultThinkingOptionId: "default" } : {}),
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cache.read,
          cacheWrite: model.cost.cache.write,
        },
      };
    });
  });
}

export function parseOpenCodeModes(agents: Agent[]): AgentMode[] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== "subagent")
    .map((agent) => ({
      id: agent.name,
      label: agent.name
        .replace(/[-_]+/gu, " ")
        .replace(/\b\w/gu, (letter) => letter.toUpperCase()),
      description: agent.description ?? `Use the ${agent.name} OpenCode agent.`,
    }));
}

export function parseOpenCodeCommands(commands: Command[]): AgentSlashCommand[] {
  return commands.map((command) => ({
    name: command.name,
    ...(command.description ? { description: command.description } : {}),
    source:
      command.source === "skill"
        ? "skill"
        : command.source === "mcp"
          ? "mcp_prompt"
          : "custom",
    ...(command.hints.length ? { argumentHint: command.hints.join(" ") } : {}),
  }));
}

function textContent(part: Part): string | null {
  if (part.type === "text") return part.text;
  if (part.type === "file") {
    return part.mime.startsWith("image/") ? null : part.filename ?? part.url;
  }
  return null;
}

function projectedContent(parts: Part[]): unknown[] {
  const content: unknown[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (!part.ignored) content.push({ type: "text", text: part.text, id: part.id });
      continue;
    }
    if (part.type === "reasoning") {
      content.push({ type: "thinking", thinking: part.text, id: part.id });
      continue;
    }
    if (part.type === "file" && part.mime.startsWith("image/")) {
      content.push({
        type: "image",
        url: part.url,
        mimeType: part.mime,
        filename: part.filename ?? "image",
        id: part.id,
      });
      continue;
    }
    if (part.type === "file") {
      content.push({ type: "text", text: part.filename ?? part.url, id: part.id });
      continue;
    }
    if (part.type === "tool") {
      content.push({
        type: "toolCall",
        id: part.callID,
        name: part.tool,
        arguments: part.state.input,
      });
    }
  }
  return content;
}

export function projectOpenCodeMessage(
  message: OpenCodeMessageWithParts,
  submissionIds: Readonly<Record<string, string>> = {},
): unknown[] {
  const { info, parts } = message;
  if (info.role === "user") {
    const content = projectedContent(parts);
    return [
      {
        id: info.id,
        role: "user",
        content: content.length ? content : parts.map(textContent).filter(Boolean).join("\n"),
        timestamp: info.time.created,
        ...(submissionIds[info.id]
          ? { overtchatSubmissionId: submissionIds[info.id] }
          : {}),
      },
    ];
  }
  const content = projectedContent(parts);
  if (info.structured !== undefined && !content.length) {
    content.push({
      type: "text",
      text:
        typeof info.structured === "string"
          ? info.structured
          : JSON.stringify(info.structured, null, 2),
    });
  }
  const messages: unknown[] = [
    {
      id: info.id,
      role: "assistant",
      content,
      timestamp: info.time.created,
      ...(info.error ? { errorMessage: openCodeErrorText(info.error) } : {}),
    },
  ];
  for (const part of parts) {
    if (part.type !== "tool") continue;
    const state = part.state;
    if (state.status !== "completed" && state.status !== "error") continue;
    messages.push({
      id: `result:${part.callID}`,
      role: "toolResult",
      toolCallId: part.callID,
      toolName: part.tool,
      content: [
        {
          type: "text",
          text: state.status === "completed" ? state.output : state.error,
        },
      ],
      isError: state.status === "error",
      timestamp: state.time.end,
    });
  }
  return messages;
}

export function projectOpenCodeMessages(
  messages: OpenCodeMessageWithParts[],
  submissionIds: Readonly<Record<string, string>> = {},
): unknown[] {
  return messages.flatMap((message) => projectOpenCodeMessage(message, submissionIds));
}

export function parseOpenCodeStats(
  messages: OpenCodeMessageWithParts[],
  contextWindow?: number,
): AgentSessionStats {
  let userMessages = 0;
  let assistantMessages = 0;
  let toolCalls = 0;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let contextTokens: number | null = null;
  for (const message of messages) {
    if (message.info.role === "user") userMessages += 1;
    else {
      assistantMessages += 1;
      input += message.info.tokens.input;
      output += message.info.tokens.output + message.info.tokens.reasoning;
      cacheRead += message.info.tokens.cache.read;
      cacheWrite += message.info.tokens.cache.write;
      cost += message.info.cost;
      contextTokens =
        message.info.tokens.input +
        message.info.tokens.output +
        message.info.tokens.reasoning +
        message.info.tokens.cache.read +
        message.info.tokens.cache.write;
    }
    toolCalls += message.parts.filter((part) => part.type === "tool").length;
  }
  const total = input + output + cacheRead + cacheWrite;
  return {
    sessionFile: null,
    sessionId: messages[0]?.info.sessionID ?? null,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults: toolCalls,
    totalMessages: messages.length,
    tokens: { input, output, cacheRead, cacheWrite, total },
    cost,
    ...(contextWindow
      ? {
          contextUsage: {
            tokens: contextTokens,
            contextWindow,
            percent:
              contextTokens === null
                ? null
                : Math.min(100, (contextTokens / contextWindow) * 100),
          },
        }
      : {}),
  };
}

function firstUserText(messages: OpenCodeMessageWithParts[]): string | null {
  for (const message of messages) {
    if (message.info.role !== "user") continue;
    const text = message.parts
      .map(textContent)
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim();
    if (text) return text;
  }
  return null;
}

export function openCodeSessionMetadata(
  session: Session,
  messages: OpenCodeMessageWithParts[],
): AgentProviderSessionMetadata {
  return {
    providerSessionId: session.id,
    providerSessionPath: session.id,
    name: session.title.trim() || null,
    firstMessage: firstUserText(messages),
    messageCount: messages.length,
    createdAt: new Date(session.time.created),
    modifiedAt: new Date(session.time.updated),
    launchConfig: {
      ...(session.model
        ? { model: `${session.model.providerID}/${session.model.id}` }
        : {}),
      ...(session.model?.variant ? { thinkingOptionId: session.model.variant } : {}),
      ...(session.agent ? { modeId: session.agent } : {}),
    },
  };
}
