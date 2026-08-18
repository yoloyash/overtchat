import type {
  AgentModel,
  AgentProviderSessionMetadata,
  AgentSessionStats,
  AgentThinkingLevel,
} from "@overtchat/agent-bridge";

export type UnknownRecord = Record<string, unknown>;

export type CodexThread = UnknownRecord & {
  id: string;
  preview: string;
  path: string | null;
  cwd: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  turns: CodexTurn[];
};

export type CodexTurn = UnknownRecord & {
  id: string;
  status: string;
  items: CodexItem[];
  startedAt: number | null;
  completedAt: number | null;
};

export type CodexItem = UnknownRecord & {
  id: string;
  type: string;
};

export function recordOf(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

export function stringOf(
  record: UnknownRecord | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

export function numberOf(
  record: UnknownRecord | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseCodexThread(value: unknown): CodexThread {
  const thread = recordOf(value);
  const id = stringOf(thread, "id");
  const cwd = stringOf(thread, "cwd");
  if (!thread || !id || !cwd) {
    throw new Error("Codex returned an invalid thread.");
  }
  return {
    ...thread,
    id,
    cwd,
    preview: stringOf(thread, "preview") ?? "",
    path: stringOf(thread, "path"),
    name: stringOf(thread, "name"),
    createdAt: numberOf(thread, "createdAt") ?? 0,
    updatedAt: numberOf(thread, "updatedAt") ?? 0,
    turns: Array.isArray(thread.turns)
      ? thread.turns.map(parseCodexTurn)
      : [],
  };
}

export function parseCodexTurn(value: unknown): CodexTurn {
  const turn = recordOf(value);
  const id = stringOf(turn, "id");
  if (!turn || !id) throw new Error("Codex returned an invalid turn.");
  return {
    ...turn,
    id,
    status: stringOf(turn, "status") ?? "completed",
    items: Array.isArray(turn.items)
      ? turn.items.flatMap((item) => {
          const record = recordOf(item);
          const itemId = stringOf(record, "id");
          const type = stringOf(record, "type");
          return record && itemId && type
            ? [{ ...record, id: itemId, type }]
            : [];
        })
      : [],
    startedAt: numberOf(turn, "startedAt"),
    completedAt: numberOf(turn, "completedAt"),
  };
}

export function parseCodexModels(value: unknown): AgentModel[] {
  const response = recordOf(value);
  if (!Array.isArray(response?.data)) {
    throw new Error("Codex returned an invalid model list.");
  }
  return response.data.flatMap((candidate) => {
    const model = recordOf(candidate);
    const id = stringOf(model, "model") ?? stringOf(model, "id");
    if (!model || !id) return [];
    const modalities = Array.isArray(model.inputModalities)
      ? model.inputModalities
      : [];
    const thinkingOptions = codexThinkingLevels(value, id).map((level) => ({
      id: level,
      label: level === "xhigh" ? "XHigh" : `${level[0]!.toUpperCase()}${level.slice(1)}`,
      ...(level === codexDefaultThinkingLevel(value, id)
        ? { isDefault: true }
        : {}),
    }));
    const defaultThinkingOptionId = codexDefaultThinkingLevel(value, id);
    return [
      {
        provider: "codex" as const,
        id,
        label: stringOf(model, "displayName") ?? id,
        ...(stringOf(model, "description")
          ? { description: stringOf(model, "description")! }
          : {}),
        ...(model.isDefault === true ? { isDefault: true } : {}),
        metadata: { provider: "codex", modelId: id },
        api: "codex-app-server",
        baseUrl: "",
        reasoning:
          Array.isArray(model.supportedReasoningEfforts) &&
          model.supportedReasoningEfforts.length > 0,
        input: [
          "text" as const,
          ...(modalities.includes("image") ? (["image"] as const) : []),
        ],
        contextWindow: null,
        maxTokens: null,
        ...(thinkingOptions.length ? { thinkingOptions } : {}),
        ...(defaultThinkingOptionId
          ? { defaultThinkingOptionId }
          : {}),
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    ];
  });
}

export function codexThinkingLevels(
  modelList: unknown,
  modelId: string | null,
): AgentThinkingLevel[] {
  const response = recordOf(modelList);
  if (!Array.isArray(response?.data)) return [];
  const model = response.data
    .map(recordOf)
    .find(
      (candidate) =>
        (stringOf(candidate, "model") ?? stringOf(candidate, "id")) ===
        modelId,
    );
  if (!Array.isArray(model?.supportedReasoningEfforts)) return [];
  const allowed = new Set<AgentThinkingLevel>([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  return model.supportedReasoningEfforts.flatMap((candidate) => {
    const effort = stringOf(recordOf(candidate), "reasoningEffort");
    return effort && allowed.has(effort as AgentThinkingLevel)
      ? [effort as AgentThinkingLevel]
      : [];
  });
}

export function codexDefaultThinkingLevel(
  modelList: unknown,
  modelId: string | null,
): AgentThinkingLevel | null {
  const response = recordOf(modelList);
  if (!Array.isArray(response?.data)) return null;
  const model = response.data
    .map(recordOf)
    .find(
      (candidate) =>
        (stringOf(candidate, "model") ?? stringOf(candidate, "id")) ===
        modelId,
    );
  const effort = stringOf(model ?? null, "defaultReasoningEffort");
  return effort &&
    codexThinkingLevels(modelList, modelId).includes(
      effort as AgentThinkingLevel,
    )
    ? (effort as AgentThinkingLevel)
    : null;
}

export function codexSessionMetadata(
  thread: CodexThread,
): AgentProviderSessionMetadata {
  return {
    providerSessionId: thread.id,
    providerSessionPath: thread.path ?? thread.id,
    name: thread.name,
    firstMessage: thread.preview.trim() || null,
    messageCount: thread.turns.reduce(
      (total, turn) => total + turn.items.length,
      0,
    ),
    createdAt:
      thread.createdAt > 0 ? new Date(thread.createdAt * 1_000) : null,
    modifiedAt:
      thread.updatedAt > 0 ? new Date(thread.updatedAt * 1_000) : null,
  };
}

export function emptyCodexStats(): AgentSessionStats {
  return {
    sessionFile: null,
    sessionId: null,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
    cost: 0,
  };
}
