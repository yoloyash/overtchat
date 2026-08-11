import type {
  AgentCollaborationMode,
  AgentGoal,
  AgentGoalStatus,
  AgentInteractionValue,
  AgentModel,
  AgentSessionStats,
  AgentSlashCommand,
  AgentThinkingLevel,
  AgentUsageSnapshot,
} from "@overtchat/agent-bridge";
import { AGENT_GOAL_STATUSES } from "@overtchat/agent-bridge";
import type {
  AgentRuntimeClient,
  AgentRuntimeEvent,
  AgentSubmissionOptions,
  ResolvedAgentImage,
  AgentSessionForkResult,
  AgentSessionLaunch,
} from "@overtchat/agent-runtime/providers/types";
import type { HostTarget } from "@overtchat/agent-runtime/runtime/process";
import { materializeAgentImages } from "@overtchat/agent-runtime/runtime/materialize-images";
import {
  type CodexAppServer,
  type CodexAppServerRequest,
  type JsonRpcId,
  startCodexAppServer,
} from "@overtchat/agent-runtime/codex/app-server";
import {
  codexDefaultThinkingLevel,
  codexSessionMetadata,
  codexThinkingLevels,
  emptyCodexStats,
  numberOf,
  parseCodexModels,
  parseCodexThread,
  parseCodexTurn,
  recordOf,
  stringOf,
  type CodexItem,
  type CodexThread,
  type CodexTurn,
  type UnknownRecord,
} from "@overtchat/agent-runtime/codex/protocol";
import {
  commandMap,
  expandCodexCustomPrompt,
  listCodexCustomPrompts,
  parseCodexSkills,
  parseCodexSlashInvocation,
  publicCommands,
  skillInput,
  type CodexDiscoveredCommand,
} from "@overtchat/agent-runtime/codex/commands";

const TURN_COMPLETION_TIMEOUT_MS = 30_000;
const COMPACTION_TIMEOUT_MS = 5 * 60_000;
const ACTIVE_WRITER_MESSAGE =
  "Another Codex process currently owns this session. You can view it here and retry when it becomes available.";
const CODEX_FAST_MODE_MODEL_PREFIXES = [
  "gpt-5",
  "gpt-4.1",
  "o3",
  "o4-mini",
] as const;
const MAX_SUBAGENT_HISTORY_THREADS = 100;
const MAX_PENDING_SUBAGENT_THREADS = 32;
const MAX_PENDING_SUBAGENT_NOTIFICATIONS = 50;
const CODEX_GOALS_MIN_VERSION = [0, 128, 0] as const;

type CodexCollaborationPreset = {
  name: string;
  mode: AgentCollaborationMode | null;
  model: string | null;
  reasoningEffort: AgentThinkingLevel | null;
};

type CodexSubagentOwner = {
  turnId: string;
  itemId: string;
};

type CompletionWaiter<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  cancel: () => void;
};

type PendingInteraction =
  | {
      kind: "approval";
      rpcId: JsonRpcId;
      method: string;
    }
  | {
      kind: "permissions";
      rpcId: JsonRpcId;
      requested: UnknownRecord;
    }
  | {
      kind: "questions";
      rpcId: JsonRpcId;
      questions: UnknownRecord[];
      index: number;
      answers: Record<string, { answers: string[] }>;
      awaitingOther: boolean;
      timeout?: number;
    }
  | {
      kind: "mcpElicitation";
      rpcId: JsonRpcId;
      mode: "form" | "url";
    };

type KnownUserInput = {
  id: string;
  text: string;
  images: Array<{
    uploadId: string;
    filename: string;
    mediaType: ResolvedAgentImage["mediaType"];
  }>;
};

function textInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

function isSyntheticUserItem(item: CodexItem): boolean {
  return (
    item.type === "userMessage" &&
    item.overtchatSyntheticUserInput === true
  );
}

function itemText(item: CodexItem): string {
  const content = item.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = recordOf(part);
      return record?.type === "text" && typeof record.text === "string"
        ? [record.text]
        : [];
    })
    .join("\n");
}

function toolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mcpElicitationOptions(
  schema: UnknownRecord,
): Array<{ value: string; label: string }> {
  if (Array.isArray(schema.enum)) {
    const labels = Array.isArray(schema.enumNames) ? schema.enumNames : [];
    return schema.enum.flatMap((value, index) =>
      typeof value === "string"
        ? [
            {
              value,
              label:
                typeof labels[index] === "string" ? labels[index] : value,
            },
          ]
        : [],
    );
  }
  const choices = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : [];
  return choices.flatMap((choice) => {
    const record = recordOf(choice);
    const value = stringOf(record, "const");
    return value
      ? [{ value, label: stringOf(record, "title") ?? value }]
      : [];
  });
}

function mcpElicitationFields(value: unknown): UnknownRecord[] {
  const schema = recordOf(value);
  const properties = recordOf(schema?.properties);
  if (!properties) return [];
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter(
          (field): field is string => typeof field === "string",
        )
      : [],
  );
  return Object.entries(properties).flatMap(([id, candidate]) => {
    const field = recordOf(candidate);
    const nativeType = stringOf(field, "type");
    if (!field || !nativeType) return [];
    const itemSchema = recordOf(field.items);
    const options =
      nativeType === "array"
        ? mcpElicitationOptions(itemSchema ?? {})
        : mcpElicitationOptions(field);
    const type =
      nativeType === "boolean"
        ? "boolean"
        : nativeType === "number" || nativeType === "integer"
          ? "number"
          : nativeType === "array" && options.length > 0
            ? "multiselect"
            : options.length > 0
              ? "select"
              : nativeType === "string"
                ? "text"
                : null;
    if (!type) return [];
    const defaultValue =
      field.default ??
      (type === "multiselect" ? [] : type === "boolean" ? false : undefined);
    return [
      {
        id,
        type,
        label: stringOf(field, "title") ?? id,
        ...(stringOf(field, "description")
          ? { description: stringOf(field, "description") }
          : {}),
        required: required.has(id),
        options,
        ...(defaultValue !== undefined ? { defaultValue } : {}),
        ...(typeof field.minimum === "number"
          ? { minimum: field.minimum }
          : {}),
        ...(typeof field.maximum === "number"
          ? { maximum: field.maximum }
          : {}),
      },
    ];
  });
}

function safeMcpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isActiveWriterError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /thread .+ already has an active writer/i.test(error.message)
  );
}

function isBeforeTurnForkUnsupportedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (/beforeTurnId/iu.test(error.message) ||
      /experimentalApi capability/iu.test(error.message))
  );
}

function codexModelSupportsFastMode(modelId: string): boolean {
  return CODEX_FAST_MODE_MODEL_PREFIXES.some(
    (prefix) => modelId === prefix || modelId.startsWith(prefix),
  );
}

function codexVersionSupportsGoals(version: string | null | undefined): boolean {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return false;
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < CODEX_GOALS_MIN_VERSION.length; index += 1) {
    if (parsed[index] > CODEX_GOALS_MIN_VERSION[index]) return true;
    if (parsed[index] < CODEX_GOALS_MIN_VERSION[index]) return false;
  }
  return true;
}

function parseGoal(value: unknown): AgentGoal | null {
  const goal = recordOf(value);
  const objective = stringOf(goal, "objective");
  const status = stringOf(goal, "status");
  if (
    !objective ||
    !status ||
    !(AGENT_GOAL_STATUSES as readonly string[]).includes(status)
  ) {
    return null;
  }
  return {
    objective,
    status: status as AgentGoalStatus,
    tokenBudget: numberOf(goal, "tokenBudget"),
    tokensUsed: numberOf(goal, "tokensUsed") ?? 0,
    timeUsedSeconds: numberOf(goal, "timeUsedSeconds") ?? 0,
    createdAt: numberOf(goal, "createdAt") ?? 0,
    updatedAt: numberOf(goal, "updatedAt") ?? 0,
  };
}

function itemTool(item: CodexItem): {
  name: string;
  args: unknown;
  output: string;
  terminalInputs: string[];
  partial: boolean;
  isError: boolean;
} | null {
  switch (item.type) {
    case "commandExecution":
      return {
        name: "bash",
        args: {
          command: stringOf(item, "command") ?? "",
          cwd: stringOf(item, "cwd") ?? "",
        },
        output: stringOf(item, "aggregatedOutput") ?? "",
        terminalInputs: Array.isArray(item.overtchatTerminalInteractions)
          ? item.overtchatTerminalInteractions.flatMap((value) => {
              const input = stringOf(recordOf(value), "stdin");
              return input ? [input] : [];
            })
          : [],
        partial: stringOf(item, "status") === "inProgress",
        isError: ["failed", "declined"].includes(
          stringOf(item, "status") ?? "",
        ),
      };
    case "fileChange": {
      const changes = Array.isArray(item.changes)
        ? item.changes.map(recordOf).filter(Boolean)
        : [];
      return {
        name: "apply_patch",
        args: {
          path: stringOf(changes[0] ?? null, "path") ?? "",
          patch: changes
            .map((change) => stringOf(change, "diff") ?? "")
            .filter(Boolean)
            .join("\n"),
        },
        output: "",
        terminalInputs: [],
        partial: stringOf(item, "status") === "inProgress",
        isError: ["failed", "declined"].includes(
          stringOf(item, "status") ?? "",
        ),
      };
    }
    case "mcpToolCall":
      return {
        name: `${stringOf(item, "server") ?? "mcp"}/${stringOf(item, "tool") ?? "tool"}`,
        args: item.arguments,
        output: toolOutput(item.result ?? item.error),
        terminalInputs: [],
        partial: stringOf(item, "status") === "inProgress",
        isError: stringOf(item, "status") === "failed",
      };
    case "dynamicToolCall":
      return {
        name: stringOf(item, "tool") ?? "tool",
        args: item.arguments,
        output: toolOutput(item.contentItems),
        terminalInputs: [],
        partial: stringOf(item, "status") === "inProgress",
        isError:
          stringOf(item, "status") === "failed" || item.success === false,
      };
    case "webSearch":
      return {
        name: "web_search",
        args: { query: stringOf(item, "query") ?? "" },
        output: toolOutput(item.results),
        terminalInputs: [],
        partial: item.results === null,
        isError: false,
      };
    case "imageView":
      return {
        name: "read",
        args: { path: stringOf(item, "path") ?? "" },
        output: "",
        terminalInputs: [],
        partial: false,
        isError: false,
      };
    default:
      return null;
  }
}

function canonicalTurnMessages(turn: CodexTurn): unknown[] {
  const startedAt = (turn.startedAt ?? Date.now() / 1_000) * 1_000;
  const completedAt =
    turn.completedAt === null ? null : turn.completedAt * 1_000;
  const messages: unknown[] = [];
  const assistantContent: UnknownRecord[] = [];
  const assistantOrders: number[] = [];
  const results: unknown[] = [];
  const planItems = turn.items.filter((item) => item.type === "plan");
  const structuredPlan = planItems.findLast((item) =>
    Array.isArray(item.steps),
  );
  const selectedPlan =
    planItems.findLast((item) => (stringOf(item, "text") ?? "").trim()) ??
    structuredPlan ??
    null;
  let planAdded = false;
  const pushAssistantContent = (content: UnknownRecord, order: number) => {
    assistantContent.push(content);
    assistantOrders.push(order);
  };

  for (const [itemIndex, item] of turn.items.entries()) {
    if (item.type === "userMessage") {
      const text = itemText(item);
      const images = Array.isArray(item.overtchatImages)
        ? item.overtchatImages.flatMap((value) => {
            const image = recordOf(value);
            const uploadId = stringOf(image, "uploadId");
            const filename = stringOf(image, "filename");
            const mediaType = stringOf(image, "mediaType");
            return uploadId && filename && mediaType
              ? [
                  {
                    type: "image",
                    url: `/api/uploads/${uploadId}`,
                    filename,
                    mimeType: mediaType,
                  },
                ]
              : [];
          })
        : [];
      if (text || images.length > 0) {
        const submissionId = stringOf(item, "overtchatSubmissionId");
        messages.push({
          id: item.id,
          role: "user",
          content:
            images.length > 0
              ? [
                  ...(text ? [{ type: "text", text }] : []),
                  ...images,
                ]
              : text,
          timestamp: startedAt + itemIndex,
          ...(submissionId
            ? { overtchatSubmissionId: submissionId }
            : {}),
        });
      }
      continue;
    }
    if (item.type === "agentMessage") {
      const text = stringOf(item, "text") ?? "";
      const phase = stringOf(item, "phase");
      if (text) {
        pushAssistantContent({
          type: "text",
          id: item.id,
          text,
          ...(phase ? { phase } : {}),
        }, itemIndex);
      }
      continue;
    }
    if (item.type === "plan") {
      if (!planAdded && item.id === selectedPlan?.id) {
        const structured = structuredPlan ?? selectedPlan;
        pushAssistantContent({
          type: "plan",
          id: selectedPlan.id,
          text: stringOf(selectedPlan, "text") ?? "",
          explanation: stringOf(structured, "explanation"),
          steps: Array.isArray(structured?.steps) ? structured.steps : [],
        }, itemIndex);
        planAdded = true;
      }
      continue;
    }
    if (item.type === "reasoning") {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((part): part is string => typeof part === "string")
        : [];
      const content = Array.isArray(item.content)
        ? item.content.filter((part): part is string => typeof part === "string")
        : [];
      const thinking = [...summary, ...content].join("\n\n");
      if (thinking) {
        pushAssistantContent({
          type: "thinking",
          id: item.id,
          thinking,
        }, itemIndex);
      }
      continue;
    }
    if (item.type === "collabAgentToolCall") {
      const receivers = Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const states = recordOf(item.agentsStates);
      pushAssistantContent({
        type: "subagent",
        id: item.id,
        action: stringOf(item, "tool") ?? "agent",
        prompt: stringOf(item, "prompt"),
        status: stringOf(item, "status") ?? "completed",
        receivers: receivers.map((threadId) => {
          const state = recordOf(states?.[threadId]);
          return {
            threadId,
            status: stringOf(state, "status") ?? "unknown",
            message: stringOf(state, "message"),
          };
        }),
        events: Array.isArray(item.overtchatChildItems)
          ? item.overtchatChildItems.flatMap((value) => {
              const child = recordOf(value);
              const type = stringOf(child, "type");
              if (type === "agentMessage") {
                const text = stringOf(child, "text");
                return text ? [text] : [];
              }
              if (type === "reasoning") {
                const summary = Array.isArray(child?.summary)
                  ? child.summary.filter(
                      (part): part is string => typeof part === "string",
                    )
                  : [];
                return summary;
              }
              if (type === "commandExecution") {
                const command = stringOf(child, "command");
                const output = stringOf(child, "aggregatedOutput");
                const terminalInputs = Array.isArray(
                  child?.overtchatTerminalInteractions,
                )
                  ? child.overtchatTerminalInteractions.flatMap((value) => {
                      const stdin = stringOf(recordOf(value), "stdin");
                      return stdin ? [`› ${stdin.replace(/\n$/u, "")}`] : [];
                    })
                  : [];
                return [
                  [
                    command ? `$ ${command}` : "",
                    output ?? "",
                    ...terminalInputs,
                  ]
                    .filter(Boolean)
                    .join("\n"),
                ].filter(Boolean);
              }
              if (type === "fileChange") {
                const paths = Array.isArray(child?.changes)
                  ? child.changes.flatMap((change) => {
                      const path = stringOf(recordOf(change), "path");
                      return path ? [path] : [];
                    })
                  : [];
                return paths.length > 0
                  ? [`Changed ${paths.join(", ")}`]
                  : [];
              }
              if (type === "plan") {
                const text = stringOf(child, "text");
                return text ? [text] : [];
              }
              return [];
            })
          : [],
      }, itemIndex);
      continue;
    }
    if (item.type === "subAgentActivity") {
      pushAssistantContent({
        type: "subagent",
        id: item.id,
        action: stringOf(item, "kind") ?? "activity",
        prompt: null,
        status:
          stringOf(item, "kind") === "interrupted"
            ? "failed"
            : "completed",
        receivers: [
          {
            threadId: stringOf(item, "agentThreadId") ?? "subagent",
            status: stringOf(item, "kind") ?? "unknown",
            message: stringOf(item, "agentPath"),
          },
        ],
      }, itemIndex);
      continue;
    }
    if (item.type === "contextCompaction") {
      messages.push({
        id: item.id,
        role: "custom",
        display: true,
        content: "Conversation context compacted.",
        timestamp: startedAt + itemIndex,
      });
      continue;
    }
    const tool = itemTool(item);
    if (!tool) continue;
    pushAssistantContent({
      type: "toolCall",
      id: item.id,
      name: tool.name,
      arguments: tool.args,
      terminalInputs: tool.terminalInputs,
    }, itemIndex);
    results.push({
      id: `${item.id}:result`,
      role: "toolResult",
      toolCallId: item.id,
      toolName: tool.name,
      content: [{ type: "text", text: tool.output }],
      overtchatPartial: tool.partial,
      isError: tool.isError,
      timestamp: startedAt + itemIndex,
    });
  }

  messages.push(
    ...assistantContent.map((content, index) => ({
      id:
        typeof content.id === "string"
          ? content.id
          : `${turn.id}:assistant:${index}`,
      role: "assistant",
      content: [content],
      timestamp: startedAt + assistantOrders[index],
      overtchatTurnId: turn.id,
      overtchatTurnBoundaryId: `${turn.id}:assistant`,
    })),
  );
  messages.push(...results);
  messages.sort(
    (left, right) =>
      (numberOf(recordOf(left), "timestamp") ?? 0) -
      (numberOf(recordOf(right), "timestamp") ?? 0),
  );
  if (turn.status !== "inProgress") {
    messages.push({
      id: `${turn.id}:footer`,
      role: "turnFooter",
      messageId:
        assistantContent.length > 0 ? `${turn.id}:assistant` : null,
      content: assistantContent
        .flatMap((content) =>
          content.type === "text" && typeof content.text === "string"
            ? [content.text]
            : [],
        )
        .join("\n\n"),
      durationMs:
        completedAt === null ? null : Math.max(0, completedAt - startedAt),
      timestamp: startedAt + turn.items.length + 1,
      ...(turn.status === "failed" && recordOf(turn.error)
        ? { errorMessage: stringOf(recordOf(turn.error), "message") ?? undefined }
        : {}),
    });
  }
  return messages;
}

function statsFromMessages(
  messages: unknown[],
  base: AgentSessionStats,
): AgentSessionStats {
  let userMessages = 0;
  const assistantTurns = new Set<string>();
  let toolCalls = 0;
  let toolResults = 0;
  let otherMessages = 0;
  for (const message of messages) {
    const record = recordOf(message);
    if (record?.role === "user") userMessages += 1;
    if (record?.role === "assistant") {
      assistantTurns.add(
        stringOf(record, "overtchatTurnId") ??
          stringOf(record, "id") ??
          `assistant:${assistantTurns.size}`,
      );
      if (Array.isArray(record.content)) {
        toolCalls += record.content.filter(
          (part) => recordOf(part)?.type === "toolCall",
        ).length;
      }
    }
    if (record?.role === "toolResult") toolResults += 1;
    if (
      record?.role &&
      !["user", "assistant", "toolResult", "turnFooter"].includes(
        String(record.role),
      )
    ) {
      otherMessages += 1;
    }
  }
  const assistantMessages = assistantTurns.size;
  return {
    ...base,
    userMessages,
    assistantMessages,
    toolCalls,
    toolResults,
    totalMessages:
      userMessages + assistantMessages + toolResults + otherMessages,
  };
}

function parseUsageSnapshot(
  rateLimitValue: unknown,
  activityValue: unknown,
  unavailableReason: string | null = null,
): AgentUsageSnapshot {
  const rateLimitResponse = recordOf(rateLimitValue);
  const byId = recordOf(rateLimitResponse?.rateLimitsByLimitId);
  const snapshots: Array<[string, unknown]> =
    byId && Object.keys(byId).length > 0
      ? Object.entries(byId)
      : [["codex", rateLimitResponse?.rateLimits]];
  const windows: AgentUsageSnapshot["windows"] = [];
  let planType: string | null = null;
  let credits: AgentUsageSnapshot["credits"] = null;

  for (const [fallbackId, value] of snapshots) {
    const snapshot = recordOf(value);
    if (!snapshot) continue;
    const id = stringOf(snapshot, "limitId") ?? fallbackId;
    const label =
      stringOf(snapshot, "limitName") ??
      id.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (char) => char.toUpperCase());
    planType ??= stringOf(snapshot, "planType");
    const creditData = recordOf(snapshot.credits);
    if (!credits && creditData) {
      credits = {
        balance: stringOf(creditData, "balance"),
        unlimited: creditData.unlimited === true,
      };
    }
    for (const [kind, windowValue] of [
      ["primary", snapshot.primary],
      ["secondary", snapshot.secondary],
    ] as const) {
      const window = recordOf(windowValue);
      const usedPercent = numberOf(window, "usedPercent");
      if (usedPercent === null) continue;
      windows.push({
        id: `${id}:${kind}`,
        label,
        usedPercent: Math.max(0, Math.min(100, usedPercent)),
        resetsAt: numberOf(window, "resetsAt"),
        windowDurationMins: numberOf(window, "windowDurationMins"),
      });
    }
  }

  const summary = recordOf(recordOf(activityValue)?.summary);
  return {
    planType,
    windows,
    credits,
    activity: summary
      ? {
          lifetimeTokens: numberOf(summary, "lifetimeTokens"),
          currentStreakDays: numberOf(summary, "currentStreakDays"),
          longestStreakDays: numberOf(summary, "longestStreakDays"),
          peakDailyTokens: numberOf(summary, "peakDailyTokens"),
        }
      : null,
    unavailableReason,
  };
}

function usageUnavailableReason(reasons: PromiseRejectedResult[]): string {
  const messages = reasons.map((result) =>
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason),
  );
  if (messages.some((message) => /authentication required/iu.test(message))) {
    return "Account usage is unavailable because this Codex connection does not expose authenticated account data.";
  }
  if (messages.some((message) => /method not found/iu.test(message))) {
    return "Account usage is unavailable in this version of Codex.";
  }
  return "Codex could not read account usage for this connection.";
}

export class CodexRuntimeClient implements AgentRuntimeClient {
  private server!: CodexAppServer;
  private readonly subscribers = new Set<(event: AgentRuntimeEvent) => void>();
  private readonly turns = new Map<string, CodexTurn>();
  private readonly pendingInteractions = new Map<string, PendingInteraction>();
  private readonly turnCompletionWaiters = new Map<
    string,
    Set<CompletionWaiter<CodexTurn>>
  >();
  private readonly knownUserInputs = new Map<string, KnownUserInput[]>();
  private readonly subagentOwners = new Map<string, CodexSubagentOwner>();
  private readonly pendingSubagentNotifications = new Map<
    string,
    Array<{ method: string; data: UnknownRecord }>
  >();
  private discoveredCommands = new Map<string, CodexDiscoveredCommand>();
  private commandRefreshPromise: Promise<void> | null = null;
  private readonly readyPromise: Promise<void>;
  private thread: CodexThread | null = null;
  private activeTurnId: string | null = null;
  private pendingPromptInput: KnownUserInput | null = null;
  private nextUserInputId = 0;
  private compactionWaiter:
    | (CompletionWaiter<CodexTurn> & { turnId: string | null })
    | null = null;
  private isCompacting = false;
  private selectedModel = "";
  private selectedThinking: AgentThinkingLevel | null = null;
  private collaborationModes: CodexCollaborationPreset[] = [];
  private selectedCollaborationMode: AgentCollaborationMode = "default";
  private fastModeEnabled = false;
  private goalsSupported = false;
  private goal: AgentGoal | null = null;
  private modelResponse: unknown = { data: [] };
  private stats = emptyCodexStats();
  private readOnly = false;
  private threadSubscribed = false;

  constructor(
    private readonly target: HostTarget,
    private readonly launch: AgentSessionLaunch,
  ) {
    this.readyPromise = this.initialize();
    void this.readyPromise.catch(() => {});
  }

  private async initialize(): Promise<void> {
    this.server = await startCodexAppServer(
      this.target,
      this.launch.executable,
      this.launch.cwd,
      {
        enableGoals: codexVersionSupportsGoals(
          this.launch.detectedVersion,
        ),
      },
    );
    this.server.onNotification((notification) =>
      this.handleNotification(notification.method, notification.params),
    );
    this.server.onRequest((request) => this.handleRequest(request));
    await this.openThread();
    await this.reloadCommands();
  }

  onEvent(subscriber: (event: AgentRuntimeEvent) => void): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  async getState(): Promise<Record<string, unknown>> {
    await this.readyPromise;
    return {
      sessionId: this.thread!.id,
      sessionFile: this.thread!.path ?? this.thread!.id,
      sessionName: this.thread!.name,
      isStreaming: this.activeTurnId !== null,
      isCompacting: this.isCompacting,
      model: { provider: "codex", id: this.selectedModel },
      collaborationMode: this.selectedCollaborationMode,
      collaborationModes: this.availableCollaborationModes(),
      fastModeEnabled: this.fastModeEnabled,
      fastModeAvailable: codexModelSupportsFastMode(this.selectedModel),
      goalsSupported: this.goalsSupported,
      goal: this.goal,
      ...(this.readOnly
        ? {
            readOnly: {
              reason: ACTIVE_WRITER_MESSAGE,
              retryable: true,
            },
          }
        : {}),
      ...(this.selectedThinking
        ? { thinkingLevel: this.selectedThinking }
        : {}),
    };
  }

  async getMessages(): Promise<{ messages: unknown[] }> {
    await this.readyPromise;
    return { messages: this.messages() };
  }

  async getAvailableModels(): Promise<AgentModel[]> {
    await this.readyPromise;
    return parseCodexModels(this.modelResponse);
  }

  async getSessionStats(): Promise<AgentSessionStats> {
    await this.readyPromise;
    return statsFromMessages(this.messages(), this.stats);
  }

  async getAvailableThinkingLevels(): Promise<AgentThinkingLevel[]> {
    await this.readyPromise;
    return codexThinkingLevels(this.modelResponse, this.selectedModel);
  }

  async getCommands(): Promise<AgentSlashCommand[]> {
    await this.readyPromise;
    return this.availableCommands();
  }

  async prompt(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    const input = this.createKnownUserInput(
      message,
      images,
      options.clientMessageId,
    );
    this.pendingPromptInput = input;
    try {
      const response = await this.server.request<UnknownRecord>("turn/start", {
        threadId: this.thread!.id,
        ...(options.clientMessageId
          ? { clientUserMessageId: options.clientMessageId }
          : {}),
        input: await this.resolvePromptInput(message, images),
        model: this.selectedModel || null,
        ...(this.selectedThinking
          ? { effort: this.selectedThinking }
          : {}),
        ...(this.fastModeEnabled ? { serviceTier: "fast" } : {}),
        ...(this.resolvedCollaborationMode()
          ? { collaborationMode: this.resolvedCollaborationMode() }
          : {}),
      });
      const turn = parseCodexTurn(response.turn);
      this.rememberUserInput(turn.id, input);
      this.turns.set(turn.id, this.withKnownUserInputs(turn));
      this.activeTurnId = turn.id;
      return response;
    } finally {
      if (this.pendingPromptInput === input) this.pendingPromptInput = null;
    }
  }

  async steer(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
    options: AgentSubmissionOptions = {},
  ): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    if (!this.activeTurnId) throw new Error("Codex has no active turn to steer.");
    const turnId = this.activeTurnId;
    const response = await this.server.request("turn/steer", {
      threadId: this.thread!.id,
      expectedTurnId: turnId,
      ...(options.clientMessageId
        ? { clientUserMessageId: options.clientMessageId }
        : {}),
      input: await this.resolvePromptInput(message, images),
    });
    this.rememberUserInput(
      turnId,
      this.createKnownUserInput(message, images, options.clientMessageId),
    );
    return response;
  }

  async abort(): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    if (!this.activeTurnId) return;
    const turnId = this.activeTurnId;
    const terminal = this.waitForTurnCompletion(
      turnId,
      TURN_COMPLETION_TIMEOUT_MS,
    );
    try {
      const response = await this.server.request("turn/interrupt", {
        threadId: this.thread!.id,
        turnId,
      });
      await terminal.promise;
      return response;
    } catch (error) {
      if (this.activeTurnId !== turnId) {
        await terminal.promise;
        return;
      }
      terminal.cancel();
      throw error;
    }
  }

  async setModel(_provider: string, modelId: string): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    const models = parseCodexModels(this.modelResponse);
    if (!models.some((model) => model.id === modelId)) {
      throw new Error(`Codex model ${modelId} is not available.`);
    }
    this.selectedModel = modelId;
    if (!codexModelSupportsFastMode(modelId)) this.fastModeEnabled = false;
    this.emitConfig();
    return { model: modelId };
  }

  async setThinkingLevel(level: string): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    const levels = await this.getAvailableThinkingLevels();
    if (!levels.includes(level as AgentThinkingLevel)) {
      throw new Error(`Codex reasoning level ${level} is not available.`);
    }
    this.selectedThinking = level as AgentThinkingLevel;
    this.emitConfig();
    return { thinkingLevel: level };
  }

  async setCollaborationMode(
    mode: AgentCollaborationMode,
  ): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    if (!this.availableCollaborationModes().includes(mode)) {
      throw new Error(
        mode === "plan"
          ? "This Codex installation does not provide Plan mode."
          : "This Codex installation does not provide Code mode.",
      );
    }
    this.selectedCollaborationMode = mode;
    this.emitConfig();
    return { collaborationMode: mode };
  }

  async setFastMode(enabled: boolean): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    if (enabled && !codexModelSupportsFastMode(this.selectedModel)) {
      throw new Error(
        `Codex model ${this.selectedModel || "unknown"} does not support Fast mode.`,
      );
    }
    this.fastModeEnabled = enabled;
    this.emitConfig();
    return { fastModeEnabled: enabled };
  }

  async updateGoal(
    action: "set" | "pause" | "resume" | "clear",
    objective?: string,
  ): Promise<AgentGoal | null> {
    await this.readyPromise;
    this.assertInteractive();
    if (!this.goalsSupported) {
      throw new Error("This Codex installation does not support durable goals.");
    }
    if (action === "clear") {
      await this.server.request("thread/goal/clear", {
        threadId: this.thread!.id,
      });
      this.goal = null;
      this.emitConfig();
      return null;
    }
    if (action === "set" && !objective?.trim()) {
      throw new Error("Usage: /goal <objective>|pause|resume|clear");
    }
    const response = await this.server.request<UnknownRecord>(
      "thread/goal/set",
      {
        threadId: this.thread!.id,
        ...(action === "set" ? { objective: objective!.trim() } : {}),
        status: action === "pause" ? "paused" : "active",
      },
    );
    this.goal = parseGoal(response.goal);
    this.emitConfig();
    return this.goal;
  }

  async compact(customInstructions?: string): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    if (customInstructions) {
      throw new Error("Codex does not support custom compaction instructions.");
    }
    if (this.isCompacting) {
      throw new Error("Codex is already compacting this thread.");
    }
    const completion = this.createCompletionWaiter<CodexTurn>(
      COMPACTION_TIMEOUT_MS,
      "Timed out waiting for Codex compaction to finish.",
    );
    this.compactionWaiter = { ...completion, turnId: null };
    this.isCompacting = true;
    this.emit({ type: "compaction_start" });
    try {
      const response = await this.server.request("thread/compact/start", {
        threadId: this.thread!.id,
      });
      await completion.promise;
      return response;
    } catch (error) {
      completion.cancel();
      throw error;
    } finally {
      if (this.compactionWaiter?.promise === completion.promise) {
        this.compactionWaiter = null;
      }
      this.isCompacting = false;
      this.emit({ type: "compaction_end" });
    }
  }

  setAutoCompaction(): Promise<unknown> {
    return Promise.reject(
      new Error("Codex manages context compaction automatically."),
    );
  }

  async setSessionName(name: string): Promise<unknown> {
    await this.readyPromise;
    this.assertInteractive();
    const result = await this.server.request("thread/name/set", {
      threadId: this.thread!.id,
      name,
    });
    this.thread = { ...this.thread!, name };
    this.emit({ type: "session_info_update", title: name });
    return result;
  }

  respondToInteraction(
    id: string,
    response: {
      value?: string;
      values?: Record<string, AgentInteractionValue>;
      confirmed?: boolean;
      cancelled?: boolean;
    },
  ): void {
    this.assertInteractive();
    const pending = this.pendingInteractions.get(id);
    if (!pending) return;
    if (pending.kind === "approval") {
      this.pendingInteractions.delete(id);
      const decision = response.cancelled
        ? "cancel"
        : response.value === "Allow for session"
          ? "acceptForSession"
          : response.value === "Allow once" || response.confirmed === true
            ? "accept"
            : "decline";
      this.server.respond(pending.rpcId, { decision });
      return;
    }
    if (pending.kind === "permissions") {
      this.pendingInteractions.delete(id);
      const allowed =
        !response.cancelled &&
        (response.value === "Allow once" ||
          response.value === "Allow for session" ||
          response.confirmed === true);
      const network = recordOf(pending.requested.network);
      const fileSystem = recordOf(pending.requested.fileSystem);
      this.server.respond(pending.rpcId, {
        permissions: allowed
          ? {
              ...(network ? { network } : {}),
              ...(fileSystem ? { fileSystem } : {}),
            }
          : {},
        scope:
          allowed && response.value === "Allow for session"
            ? "session"
            : "turn",
      });
      return;
    }
    if (pending.kind === "mcpElicitation") {
      this.pendingInteractions.delete(id);
      const accepted =
        !response.cancelled &&
        (response.confirmed === true || response.values !== undefined);
      this.server.respond(pending.rpcId, {
        action: response.cancelled
          ? "cancel"
          : accepted
            ? "accept"
            : "decline",
        content:
          accepted && pending.mode === "form"
            ? (response.values ?? {})
            : null,
        _meta: null,
      });
      return;
    }
    this.handleQuestionResponse(id, pending, response);
  }

  async stop(): Promise<void> {
    await this.readyPromise.catch(() => {});
    if (!this.server) return;
    if (this.thread?.id && this.threadSubscribed) {
      await this.server
        .request(
          "thread/unsubscribe",
          { threadId: this.thread.id },
          5_000,
        )
        .catch(() => {});
      this.threadSubscribed = false;
    }
    await this.server.stop();
  }

  async retryInteractive(): Promise<unknown> {
    await this.readyPromise;
    if (!this.readOnly) return;
    const response = await this.server.request<UnknownRecord>("thread/resume", {
      threadId: this.thread!.id,
      cwd: this.launch.cwd,
    });
    this.threadSubscribed = true;
    const hydrated = await this.server.request<UnknownRecord>("thread/read", {
      threadId: this.thread!.id,
      includeTurns: true,
    });
    this.hydrateThread(hydrated);
    this.applyThreadConfiguration(response);
    this.readOnly = false;
    return response;
  }

  async getUsage(): Promise<AgentUsageSnapshot> {
    await this.readyPromise;
    const [rateLimits, activity] = await Promise.allSettled([
      this.server.request("account/rateLimits/read"),
      this.server.request("account/usage/read"),
    ]);
    const rejected = [rateLimits, activity].filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    return parseUsageSnapshot(
      rateLimits.status === "fulfilled" ? rateLimits.value : null,
      activity.status === "fulfilled" ? activity.value : null,
      rateLimits.status === "rejected" && activity.status === "rejected"
        ? usageUnavailableReason(rejected)
        : null,
    );
  }

  async forkSession(
    messageId: string,
    mode: "edit" | "fork",
  ): Promise<AgentSessionForkResult> {
    await this.readyPromise;
    if (this.activeTurnId) {
      throw new Error("Wait for the current Codex turn to finish first.");
    }

    const turns = this.orderedTurns();
    let response: UnknownRecord;
    let draft: string | undefined;

    if (mode === "edit") {
      const target = turns
        .map((turn, turnIndex) => ({
          turn,
          turnIndex,
          item: turn.items.find(
            (item) => item.id === messageId && item.type === "userMessage",
          ),
        }))
        .find((candidate) => candidate.item);
      if (!target?.item) {
        throw new Error("Codex could not find that user message.");
      }
      draft = itemText(target.item);
      if (!draft) {
        throw new Error("Codex could not restore that user message.");
      }
      const previousTurn = turns[target.turnIndex - 1];
      try {
        response = await this.server.request<UnknownRecord>("thread/fork", {
          threadId: this.thread!.id,
          ...(previousTurn
            ? { lastTurnId: previousTurn.id }
            : { beforeTurnId: target.turn.id }),
          cwd: this.launch.cwd,
          model: this.selectedModel || null,
          ephemeral: false,
        });
      } catch (error) {
        if (!previousTurn && isBeforeTurnForkUnsupportedError(error)) {
          throw new Error(
            "Editing the first message requires a newer Codex installation.",
            { cause: error },
          );
        }
        throw error;
      }
    } else {
      const turnId = messageId.endsWith(":assistant")
        ? messageId.slice(0, -":assistant".length)
        : messageId;
      const target = turns.find((turn) => turn.id === turnId);
      if (!target) {
        throw new Error("Codex could not find that assistant response.");
      }
      response = await this.server.request<UnknownRecord>("thread/fork", {
        threadId: this.thread!.id,
        lastTurnId: target.id,
        cwd: this.launch.cwd,
        model: this.selectedModel || null,
        ephemeral: false,
      });
    }

    const thread = parseCodexThread(response.thread);
    if (thread.id === this.thread!.id) {
      throw new Error("Codex did not create a new thread.");
    }
    await this.server.request(
      "thread/unsubscribe",
      { threadId: thread.id },
      5_000,
    );
    return {
      session: codexSessionMetadata(thread),
      ...(draft !== undefined ? { draft } : {}),
    };
  }

  async discardForkedSession(
    session: AgentSessionForkResult["session"],
  ): Promise<void> {
    await this.readyPromise;
    await this.server.request(
      "thread/delete",
      { threadId: session.providerSessionId },
      5_000,
    );
  }

  private async openThread(): Promise<void> {
    await this.server.ready();
    const modelPromise = this.server.request("model/list", { limit: 200 });
    const collaborationModePromise = this.server
      .request("collaborationMode/list", {})
      .catch(() => null);
    let threadResponse: UnknownRecord;
    let hydratedThread: UnknownRecord;
    if (this.launch.resume) {
      try {
        threadResponse = await this.server.request<UnknownRecord>(
          "thread/resume",
          {
            threadId: this.launch.resume.providerSessionId,
            cwd: this.launch.cwd,
          },
        );
        this.threadSubscribed = true;
      } catch (error) {
        if (!isActiveWriterError(error)) throw error;
        this.readOnly = true;
        threadResponse = {};
      }
      hydratedThread = await this.server.request<UnknownRecord>("thread/read", {
        threadId: this.launch.resume.providerSessionId,
        includeTurns: true,
      });
    } else {
      threadResponse = await this.server.request<UnknownRecord>(
        "thread/start",
        {
          cwd: this.launch.cwd,
          ephemeral: false,
        },
      );
      this.threadSubscribed = true;
      hydratedThread = threadResponse;
    }
    this.modelResponse = await modelPromise;
    this.loadCollaborationModes(await collaborationModePromise);
    this.hydrateThread(hydratedThread);
    this.applyThreadConfiguration(threadResponse);
    await this.hydrateSubagentHistories();
    await this.loadGoal();
  }

  private hydrateThread(value: UnknownRecord): void {
    this.thread = parseCodexThread(value.thread);
    this.turns.clear();
    this.subagentOwners.clear();
    this.pendingSubagentNotifications.clear();
    for (const turn of this.thread.turns) {
      this.turns.set(turn.id, turn);
      for (const item of turn.items) {
        this.registerSubagentOwners(turn.id, item);
      }
    }
  }

  private applyThreadConfiguration(threadResponse: UnknownRecord): void {
    this.selectedModel =
      stringOf(threadResponse, "model") ??
      parseCodexModels(this.modelResponse)[0]?.id ??
      "";
    const effort = stringOf(threadResponse, "reasoningEffort");
    if (
      effort &&
      codexThinkingLevels(this.modelResponse, this.selectedModel).includes(
        effort as AgentThinkingLevel,
      )
    ) {
      this.selectedThinking = effort as AgentThinkingLevel;
    } else {
      this.selectedThinking = codexDefaultThinkingLevel(
        this.modelResponse,
        this.selectedModel,
      );
    }
    this.fastModeEnabled =
      stringOf(threadResponse, "serviceTier") === "fast" &&
      codexModelSupportsFastMode(this.selectedModel);
  }

  private loadCollaborationModes(value: unknown): void {
    const response = recordOf(value);
    const data = Array.isArray(response?.data) ? response.data : [];
    this.collaborationModes = data.flatMap((candidate) => {
      const preset = recordOf(candidate);
      const name = stringOf(preset, "name");
      const rawMode = stringOf(preset, "mode");
      if (!name) return [];
      const mode =
        rawMode === "plan" || rawMode === "default" ? rawMode : null;
      const effort = stringOf(preset, "reasoning_effort");
      return [
        {
          name,
          mode,
          model: stringOf(preset, "model"),
          reasoningEffort:
            effort &&
            ["minimal", "low", "medium", "high", "xhigh", "max"].includes(
              effort,
            )
              ? (effort as AgentThinkingLevel)
              : null,
        },
      ];
    });
    if (!this.availableCollaborationModes().includes("default")) {
      this.selectedCollaborationMode =
        this.availableCollaborationModes()[0] ?? "default";
    }
  }

  private availableCollaborationModes(): AgentCollaborationMode[] {
    return (["default", "plan"] as const).filter(
      (mode) => this.findCollaborationMode(mode) !== null,
    );
  }

  private findCollaborationMode(
    mode: AgentCollaborationMode,
  ): CodexCollaborationPreset | null {
    if (mode === "plan") {
      return (
        this.collaborationModes.find(
          (preset) =>
            preset.mode === "plan" ||
            /plan|read/iu.test(preset.name),
        ) ?? null
      );
    }
    return (
      this.collaborationModes.find(
        (preset) =>
          preset.mode === "default" ||
          /auto|code/iu.test(preset.name),
      ) ??
      this.collaborationModes.find(
        (preset) => !/plan|read/iu.test(preset.name),
      ) ??
      null
    );
  }

  private resolvedCollaborationMode(): UnknownRecord | null {
    const preset = this.findCollaborationMode(
      this.selectedCollaborationMode,
    );
    if (!preset) return null;
    return {
      mode: preset.mode ?? this.selectedCollaborationMode,
      settings: {
        model: this.selectedModel || preset.model || "",
        reasoning_effort:
          this.selectedThinking ?? preset.reasoningEffort ?? null,
        developer_instructions: null,
      },
    };
  }

  private async loadGoal(): Promise<void> {
    try {
      const response = await this.server.request<UnknownRecord>(
        "thread/goal/get",
        { threadId: this.thread!.id },
      );
      if (!Object.hasOwn(response, "goal")) {
        throw new Error("Codex returned an invalid goal response.");
      }
      this.goalsSupported = true;
      this.goal = parseGoal(response.goal);
    } catch {
      this.goalsSupported = false;
      this.goal = null;
    }
  }

  private assertInteractive(): void {
    if (this.readOnly) throw new Error(ACTIVE_WRITER_MESSAGE);
  }

  private messages(): unknown[] {
    return this.orderedTurns().flatMap(canonicalTurnMessages);
  }

  private orderedTurns(): CodexTurn[] {
    return [...this.turns.values()].sort(
      (left, right) =>
        (left.startedAt ?? 0) - (right.startedAt ?? 0),
    );
  }

  private handleNotification(method: string, params: unknown): void {
    const data = recordOf(params);
    if (method === "overtchat/processExit") {
      const error = new Error(stringOf(data, "error") ?? "Codex exited.");
      this.rejectCompletionWaiters(error);
      this.emit({
        type: "process_exit",
        code: numberOf(data, "code"),
        signal: stringOf(data, "signal"),
        error: error.message,
      });
      return;
    }
    const notificationThreadId = stringOf(data, "threadId");
    if (
      notificationThreadId &&
      this.thread?.id &&
      notificationThreadId !== this.thread.id
    ) {
      const notification = { method, data: data ?? {} };
      if (this.subagentOwners.has(notificationThreadId)) {
        this.handleSubagentNotification(
          notification.method,
          notification.data,
          notificationThreadId,
        );
      } else {
        let pending =
          this.pendingSubagentNotifications.get(notificationThreadId);
        if (!pending) {
          if (
            this.pendingSubagentNotifications.size >=
            MAX_PENDING_SUBAGENT_THREADS
          ) {
            const oldest = this.pendingSubagentNotifications.keys().next().value;
            if (typeof oldest === "string") {
              this.pendingSubagentNotifications.delete(oldest);
            }
          }
          pending = [];
        }
        pending.push(notification);
        if (pending.length > MAX_PENDING_SUBAGENT_NOTIFICATIONS) {
          pending.shift();
        }
        this.pendingSubagentNotifications.set(notificationThreadId, pending);
      }
      return;
    }
    if (method === "overtchat/protocolError") {
      this.emit({
        type: "rpc_error",
        command: "protocol",
        error: stringOf(data, "error") ?? "Codex protocol error.",
      });
      return;
    }
    if (method === "turn/started") {
      const turn = parseCodexTurn(data?.turn);
      this.turns.set(turn.id, this.withKnownUserInputs(turn));
      if (this.pendingPromptInput) {
        this.rememberUserInput(turn.id, this.pendingPromptInput);
      }
      this.activeTurnId = turn.id;
      this.emit({ type: "turn_start", turnId: turn.id });
      return;
    }
    if (method === "item/started" || method === "item/completed") {
      const turnId = stringOf(data, "turnId");
      const item = recordOf(data?.item);
      if (turnId && item) {
        this.upsertItem(turnId, item);
        if (
          method === "item/started" &&
          stringOf(item, "type") === "contextCompaction" &&
          this.compactionWaiter
        ) {
          this.compactionWaiter.turnId = turnId;
        }
      }
      return;
    }
    if (method === "item/agentMessage/delta") {
      this.appendItemText(data, "text", stringOf(data, "delta") ?? "");
      return;
    }
    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta"
    ) {
      const key =
        method === "item/reasoning/textDelta" ? "content" : "summary";
      this.appendItemArrayText(
        data,
        key,
        method === "item/reasoning/textDelta"
          ? numberOf(data, "contentIndex") ?? 0
          : numberOf(data, "summaryIndex") ?? 0,
        stringOf(data, "delta") ?? "",
      );
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      this.appendItemText(
        data,
        "aggregatedOutput",
        stringOf(data, "delta") ?? "",
      );
      return;
    }
    if (method === "item/commandExecution/terminalInteraction") {
      const turnId = stringOf(data, "turnId");
      const itemId = stringOf(data, "itemId");
      const stdin = stringOf(data, "stdin");
      const turn = turnId ? this.turns.get(turnId) : undefined;
      const item = turn?.items.find((candidate) => candidate.id === itemId);
      if (turn && item && stdin) {
        const interactions = Array.isArray(
          item.overtchatTerminalInteractions,
        )
          ? [...item.overtchatTerminalInteractions]
          : [];
        interactions.push({
          processId: stringOf(data, "processId"),
          stdin,
        });
        item.overtchatTerminalInteractions = interactions;
        this.emitTurn(turn);
      }
      return;
    }
    if (method === "item/fileChange/patchUpdated") {
      const turnId = stringOf(data, "turnId");
      const itemId = stringOf(data, "itemId");
      const turn = turnId ? this.turns.get(turnId) : undefined;
      const item = turn?.items.find((candidate) => candidate.id === itemId);
      if (turn && item && Array.isArray(data?.changes)) {
        item.changes = data.changes;
        this.emitTurn(turn);
      }
      return;
    }
    if (method === "turn/plan/updated") {
      const turnId = stringOf(data, "turnId");
      if (turnId) {
        const steps = Array.isArray(data?.plan)
          ? data.plan.flatMap((value) => {
              const step = recordOf(value);
              const text = stringOf(step, "step");
              const status = stringOf(step, "status");
              return text
                ? [{ step: text, status: status ?? "pending" }]
                : [];
            })
          : [];
        const text = steps
          .map(({ step, status }) => {
            const marker = status === "completed" ? "x" : " ";
            return `- [${marker}] ${step}`;
          })
          .join("\n");
        this.upsertItem(turnId, {
          id: `overtchat:turn-plan:${turnId}`,
          type: "plan",
          text,
          explanation: stringOf(data, "explanation"),
          steps,
        });
      }
      return;
    }
    if (method === "item/plan/delta") {
      this.appendItemText(data, "text", stringOf(data, "delta") ?? "");
      return;
    }
    if (method === "turn/diff/updated") {
      // This is accumulated progress telemetry. Concrete fileChange items
      // remain the durable review surface.
      return;
    }
    if (method === "thread/tokenUsage/updated") {
      this.updateTokenUsage(data);
      return;
    }
    if (method === "thread/name/updated") {
      const name = stringOf(data, "threadName");
      if (name && this.thread) {
        this.thread = { ...this.thread, name };
        this.emit({ type: "session_info_update", title: name });
      }
      return;
    }
    if (method === "thread/settings/updated") {
      const threadId = stringOf(data, "threadId");
      if (!threadId || threadId === this.thread?.id) {
        const settings = recordOf(data?.threadSettings);
        this.fastModeEnabled =
          stringOf(settings, "serviceTier") === "fast" &&
          codexModelSupportsFastMode(this.selectedModel);
        const collaboration = recordOf(settings?.collaborationMode);
        const mode = stringOf(collaboration, "mode");
        if (
          (mode === "default" || mode === "plan") &&
          this.availableCollaborationModes().includes(mode)
        ) {
          this.selectedCollaborationMode = mode;
        }
        this.emitConfig();
      }
      return;
    }
    if (method === "thread/goal/updated") {
      const threadId = stringOf(data, "threadId");
      if (!threadId || threadId === this.thread?.id) {
        this.goalsSupported = true;
        this.goal = parseGoal(data?.goal);
        this.emitConfig();
      }
      return;
    }
    if (method === "thread/goal/cleared") {
      const threadId = stringOf(data, "threadId");
      if (!threadId || threadId === this.thread?.id) {
        this.goalsSupported = true;
        this.goal = null;
        this.emitConfig();
      }
      return;
    }
    if (method === "skills/changed") {
      void this.reloadCommands(true);
      return;
    }
    if (method === "turn/completed") {
      const completedTurn = this.withKnownUserInputs(
        parseCodexTurn(data?.turn),
      );
      const turn = this.withKnownUserInputs(
        this.reconcileCompletedTurn(completedTurn),
      );
      this.turns.set(turn.id, turn);
      this.emitTurn(turn);
      if (this.activeTurnId === turn.id) this.activeTurnId = null;
      this.resolveTurnCompletion(turn);
      const isCompactionTurn =
        this.compactionWaiter?.turnId === turn.id ||
        (this.compactionWaiter?.turnId === null &&
          turn.items.some((item) => item.type === "contextCompaction"));
      if (isCompactionTurn && this.compactionWaiter) {
        if (turn.status === "completed") {
          this.compactionWaiter.resolve(turn);
        } else {
          this.compactionWaiter.reject(
            new Error(
              turn.status === "failed"
                ? stringOf(recordOf(turn.error), "message") ??
                    "Codex compaction failed."
                : "Codex compaction was interrupted.",
            ),
          );
        }
      }
      if (turn.status === "failed") {
        const message =
          stringOf(recordOf(turn.error), "message") ?? "Codex turn failed.";
        this.emit({ type: "rpc_error", command: "prompt", error: message });
      }
      this.emit({
        type: "turn_end",
        turnId: turn.id,
        status: turn.status,
      });
      return;
    }
    if (method === "serverRequest/resolved") {
      const requestId = data?.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        const id = `codex:${requestId}`;
        this.pendingInteractions.delete(id);
        this.emit({ type: "interaction_resolved", id });
      }
      return;
    }
    if (method === "error") {
      const error = recordOf(data?.error);
      this.emit({
        type: "rpc_error",
        command: "prompt",
        error: stringOf(error, "message") ?? "Codex reported an error.",
      });
    }
  }

  private handleRequest(request: CodexAppServerRequest): void {
    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval"
    ) {
      const params = recordOf(request.params);
      const command = stringOf(params, "command");
      const reason = stringOf(params, "reason");
      const network = recordOf(params?.networkApprovalContext);
      const id = `codex:${request.id}`;
      this.pendingInteractions.set(id, {
        kind: "approval",
        rpcId: request.id,
        method: request.method,
      });
      this.emit({
        type: "interaction_request",
        id,
        method: "select",
        title:
          network
            ? "Approve network access?"
            : request.method === "item/fileChange/requestApproval"
            ? "Approve file changes?"
            : "Approve command?",
        message:
          [
            reason,
            network
              ? [
                  stringOf(network, "host"),
                  stringOf(network, "protocol"),
                  numberOf(network, "port"),
                ]
                  .filter((value) => value !== null && value !== undefined)
                  .join(" · ")
              : null,
            !network && command ? `$ ${command}` : null,
          ]
            .filter(Boolean)
            .join("\n\n") || "Codex needs approval to continue.",
        options: ["Allow once", "Allow for session", "Deny"],
      });
      return;
    }
    if (
      request.method === "item/tool/requestUserInput" ||
      request.method === "tool/requestUserInput"
    ) {
      const params = recordOf(request.params);
      const questions = Array.isArray(params?.questions)
        ? params.questions
            .map(recordOf)
            .filter((question): question is UnknownRecord => question !== null)
        : [];
      if (questions.length === 0) {
        this.server.respond(request.id, { answers: {} });
        return;
      }
      const id = `codex:${request.id}`;
      const pending: Extract<
        PendingInteraction,
        { kind: "questions" }
      > = {
        kind: "questions",
        rpcId: request.id,
        questions,
        index: 0,
        answers: {},
        awaitingOther: false,
        ...(typeof params?.autoResolutionMs === "number" &&
        params.autoResolutionMs > 0
          ? { timeout: params.autoResolutionMs }
          : {}),
      };
      this.pendingInteractions.set(id, pending);
      this.emitQuestion(id, pending);
      return;
    }
    if (request.method === "mcpServer/elicitation/request") {
      const params = recordOf(request.params);
      const mode = stringOf(params, "mode");
      const serverName = stringOf(params, "serverName") ?? "MCP server";
      const message =
        stringOf(params, "message") ??
        `${serverName} needs additional information.`;
      const id = `codex:${request.id}`;
      if (mode === "url") {
        const url = safeMcpUrl(params?.url);
        if (!url) {
          this.server.respond(request.id, {
            action: "decline",
            content: null,
            _meta: null,
          });
          return;
        }
        this.pendingInteractions.set(id, {
          kind: "mcpElicitation",
          rpcId: request.id,
          mode: "url",
        });
        this.emit({
          type: "interaction_request",
          id,
          method: "external",
          title: `Continue with ${serverName}?`,
          message,
          url,
        });
        return;
      }
      if (mode === "form" || mode === "openai/form") {
        const fields = mcpElicitationFields(params?.requestedSchema);
        if (fields.length === 0) {
          this.server.respond(request.id, {
            action: "decline",
            content: null,
            _meta: null,
          });
          return;
        }
        this.pendingInteractions.set(id, {
          kind: "mcpElicitation",
          rpcId: request.id,
          mode: "form",
        });
        this.emit({
          type: "interaction_request",
          id,
          method: "form",
          title: `${serverName} needs your input`,
          message,
          fields,
        });
        return;
      }
      this.server.respond(request.id, {
        action: "decline",
        content: null,
        _meta: null,
      });
      return;
    }
    if (request.method === "item/permissions/requestApproval") {
      const params = recordOf(request.params);
      const requested = recordOf(params?.permissions) ?? {};
      const id = `codex:${request.id}`;
      this.pendingInteractions.set(id, {
        kind: "permissions",
        rpcId: request.id,
        requested,
      });
      const details = [
        params?.reason,
        requested.network
          ? `Network: ${toolOutput(requested.network)}`
          : null,
        requested.fileSystem
          ? `Files: ${toolOutput(requested.fileSystem)}`
          : null,
      ]
        .filter((value): value is string => typeof value === "string" && !!value)
        .join("\n\n");
      this.emit({
        type: "interaction_request",
        id,
        method: "select",
        title: "Approve additional permissions?",
        message: details || "Codex needs additional permissions to continue.",
        options: ["Allow once", "Allow for session", "Deny"],
      });
      return;
    }
    this.server.respondError(
      request.id,
      -32601,
      `OvertChat does not support ${request.method}.`,
    );
  }

  private handleQuestionResponse(
    id: string,
    pending: Extract<PendingInteraction, { kind: "questions" }>,
    response: {
      value?: string;
      cancelled?: boolean;
    },
  ): void {
    if (response.cancelled) {
      this.pendingInteractions.delete(id);
      this.server.respond(pending.rpcId, { answers: pending.answers });
      return;
    }
    const question = pending.questions[pending.index];
    const questionId = stringOf(question, "id");
    if (!questionId) return;
    if (response.value === "Other…" && !pending.awaitingOther) {
      pending.awaitingOther = true;
      this.emitQuestion(id, pending);
      return;
    }
    pending.answers[questionId] = {
      answers: response.value === undefined ? [] : [response.value],
    };
    pending.index += 1;
    pending.awaitingOther = false;
    if (pending.index < pending.questions.length) {
      this.emitQuestion(id, pending);
      return;
    }
    this.pendingInteractions.delete(id);
    this.server.respond(pending.rpcId, { answers: pending.answers });
  }

  private emitQuestion(
    id: string,
    pending: Extract<PendingInteraction, { kind: "questions" }>,
  ): void {
    const question = pending.questions[pending.index];
    const options = Array.isArray(question?.options)
      ? question.options
          .map(recordOf)
          .flatMap((option) => {
            const label = stringOf(option, "label");
            return label ? [label] : [];
          })
      : [];
    const other = question?.isOther === true;
    this.emit({
      type: "interaction_request",
      id,
      method:
        pending.awaitingOther || (options.length === 0 && !other)
          ? "input"
          : "select",
      title: stringOf(question, "header") ?? "Codex needs your input",
      message: stringOf(question, "question") ?? "",
      ...(question?.isSecret === true ? { secret: true } : {}),
      ...(pending.timeout ? { timeout: pending.timeout } : {}),
      ...(pending.awaitingOther
        ? { placeholder: "Enter another answer" }
        : options.length > 0 || other
          ? { options: [...options, ...(other ? ["Other…"] : [])] }
          : {}),
    });
  }

  private createKnownUserInput(
    text: string,
    images: readonly ResolvedAgentImage[] = [],
    clientMessageId?: string,
  ): KnownUserInput {
    return {
      id:
        clientMessageId ??
        `overtchat:codex-user:${++this.nextUserInputId}`,
      text,
      images: images.map(({ uploadId, filename, mediaType }) => ({
        uploadId,
        filename,
        mediaType,
      })),
    };
  }

  private async resolvePromptInput(
    message: string,
    images: readonly ResolvedAgentImage[] = [],
  ): Promise<UnknownRecord[]> {
    const invocation = parseCodexSlashInvocation(message);
    const command = invocation
      ? this.discoveredCommands.get(invocation.name.toLowerCase())
      : undefined;
    const text = !invocation || !command
      ? textInput(message)
      : command.source === "skill"
        ? skillInput(command, invocation.arguments)
        : textInput(
            expandCodexCustomPrompt(command.template, invocation.arguments),
          );
    const paths = await materializeAgentImages(this.target, images);
    return [
      ...text,
      ...paths.map((path) => ({ type: "localImage", path })),
    ];
  }

  private async reloadCommands(publish = false): Promise<void> {
    if (this.commandRefreshPromise) return this.commandRefreshPromise;
    const refresh = (async () => {
      const [skills, prompts] = await Promise.all([
        this.server
          .request("skills/list", { cwds: [this.launch.cwd] })
          .then(parseCodexSkills)
          .catch(() => []),
        listCodexCustomPrompts(this.target).catch((error) => {
          console.warn(
            "Unable to load Codex custom prompts:",
            error instanceof Error ? error.message : String(error),
          );
          return [];
        }),
      ]);
      this.discoveredCommands = commandMap(
        [...skills, ...prompts].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      );
      if (publish) {
        this.emit({
          type: "available_commands_update",
          commands: this.availableCommands(),
        });
      }
    })();
    this.commandRefreshPromise = refresh;
    try {
      await refresh;
    } finally {
      if (this.commandRefreshPromise === refresh) {
        this.commandRefreshPromise = null;
      }
    }
  }

  private rememberUserInput(turnId: string, input: KnownUserInput): void {
    const inputs = this.knownUserInputs.get(turnId) ?? [];
    if (!inputs.some((candidate) => candidate.id === input.id)) {
      inputs.push(input);
      this.knownUserInputs.set(turnId, inputs);
    }
    const turn = this.turns.get(turnId);
    if (!turn) return;
    const next = this.withKnownUserInputs(turn);
    this.turns.set(turnId, next);
    this.emitTurn(next);
  }

  private withKnownUserInputs(turn: CodexTurn): CodexTurn {
    const known = this.knownUserInputs.get(turn.id);
    if (!known?.length) return turn;
    const items = turn.items.filter((item) => !isSyntheticUserItem(item));
    const nativeUsers = items.flatMap((item, index) =>
      item.type === "userMessage" ? [{ index, text: itemText(item) }] : [],
    );
    const claimedNativeUsers = new Set<number>();
    const synthetic: CodexItem[] = [];
    for (const input of known) {
      const native = nativeUsers.find(
        (candidate) =>
          !claimedNativeUsers.has(candidate.index) &&
          candidate.text === input.text,
      );
      if (native) {
        claimedNativeUsers.add(native.index);
        items[native.index] = {
          ...items[native.index],
          overtchatSubmissionId: input.id,
          ...(input.images.length > 0
            ? { overtchatImages: input.images }
            : {}),
        };
        continue;
      }
      synthetic.push({
        id: input.id,
        type: "userMessage",
        content: textInput(input.text),
        overtchatSubmissionId: input.id,
        overtchatSyntheticUserInput: true,
        ...(input.images.length > 0
          ? { overtchatImages: input.images }
          : {}),
      });
    }
    return synthetic.length === 0 && items.length === turn.items.length
      ? turn
      : { ...turn, items: [...synthetic, ...items] };
  }

  private reconcileCompletedTurn(completed: CodexTurn): CodexTurn {
    const streamed = this.turns.get(completed.id);
    if (!streamed) return completed;
    const items = [...streamed.items];
    const indexById = new Map(
      items.map((item, index) => [item.id, index] as const),
    );
    for (const item of completed.items) {
      const index = indexById.get(item.id);
      if (index === undefined) {
        indexById.set(item.id, items.length);
        items.push(item);
      } else {
        const streamedItem = items[index];
        items[index] = {
          ...streamedItem,
          ...item,
          ...(Array.isArray(streamedItem.overtchatTerminalInteractions) &&
          !Array.isArray(item.overtchatTerminalInteractions)
            ? {
                overtchatTerminalInteractions:
                  streamedItem.overtchatTerminalInteractions,
              }
            : {}),
          ...(Array.isArray(streamedItem.overtchatChildItems) &&
          !Array.isArray(item.overtchatChildItems)
            ? { overtchatChildItems: streamedItem.overtchatChildItems }
            : {}),
        };
      }
    }
    return {
      ...streamed,
      ...completed,
      items,
      startedAt: completed.startedAt ?? streamed.startedAt,
      completedAt: completed.completedAt ?? streamed.completedAt,
    };
  }

  private upsertItem(turnId: string, value: UnknownRecord): void {
    const id = stringOf(value, "id");
    const type = stringOf(value, "type");
    if (!id || !type) return;
    const turn =
      this.turns.get(turnId) ??
      parseCodexTurn({
        id: turnId,
        status: "inProgress",
        items: [],
        startedAt: Date.now() / 1_000,
      });
    const item = { ...value, id, type };
    const index = turn.items.findIndex((candidate) => candidate.id === id);
    if (index >= 0) turn.items[index] = item;
    else turn.items.push(item);
    const reconciled = this.withKnownUserInputs(turn);
    this.turns.set(turnId, reconciled);
    this.registerSubagentOwners(turnId, item);
    this.emitTurn(reconciled);
  }

  private registerSubagentOwners(turnId: string, item: CodexItem): void {
    this.registerSubagentThreads({ turnId, itemId: item.id }, item);
  }

  private registerSubagentThreads(
    owner: CodexSubagentOwner,
    item: CodexItem,
  ): string[] {
    const receiverThreadIds =
      item.type === "collabAgentToolCall" &&
      Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter(
            (value): value is string => typeof value === "string",
          )
        : item.type === "subAgentActivity"
          ? [stringOf(item, "agentThreadId")].filter(
              (value): value is string => Boolean(value),
            )
          : [];
    const registered: string[] = [];
    for (const threadId of receiverThreadIds) {
      if (threadId !== this.thread?.id) {
        this.subagentOwners.set(threadId, owner);
        registered.push(threadId);
        const pending = this.pendingSubagentNotifications.get(threadId);
        if (pending) {
          this.pendingSubagentNotifications.delete(threadId);
          for (const notification of pending) {
            this.handleSubagentNotification(
              notification.method,
              notification.data,
              threadId,
            );
          }
        }
      }
    }
    return registered;
  }

  private async hydrateSubagentHistories(): Promise<void> {
    if (!this.thread) return;
    const queue = [...this.subagentOwners.keys()];
    const visited = new Set([this.thread.id]);
    while (
      queue.length > 0 &&
      visited.size < MAX_SUBAGENT_HISTORY_THREADS
    ) {
      const childThreadId = queue.shift();
      if (!childThreadId || visited.has(childThreadId)) continue;
      visited.add(childThreadId);
      const owner = this.subagentOwners.get(childThreadId);
      if (!owner) continue;
      try {
        const response = await this.server.request<UnknownRecord>(
          "thread/read",
          { threadId: childThreadId, includeTurns: true },
        );
        const childThread = parseCodexThread(response.thread);
        const turn = this.turns.get(owner.turnId);
        const item = turn?.items.find(
          (candidate) => candidate.id === owner.itemId,
        );
        if (!item) continue;
        const childItems = Array.isArray(item.overtchatChildItems)
          ? [...item.overtchatChildItems]
          : [];
        const indexes = new Map(
          childItems.flatMap((candidate, index) => {
            const id = stringOf(recordOf(candidate), "id");
            return id ? [[id, index] as const] : [];
          }),
        );
        for (const childTurn of childThread.turns) {
          for (const childItem of childTurn.items) {
            const hydrated = {
              ...childItem,
              overtchatThreadId: childThreadId,
            };
            const index = indexes.get(childItem.id);
            if (index === undefined) {
              indexes.set(childItem.id, childItems.length);
              childItems.push(hydrated);
            } else {
              childItems[index] = {
                ...recordOf(childItems[index]),
                ...hydrated,
              };
            }
            item.overtchatChildItems = childItems;
            queue.push(...this.registerSubagentThreads(owner, childItem));
          }
        }
        item.overtchatChildItems = childItems;
      } catch {
        // Child threads can be archived or deleted independently.
      }
    }
  }

  private availableCommands(): AgentSlashCommand[] {
    return [
      ...(this.availableCollaborationModes().includes("plan")
        ? [
            {
              name: "plan",
              description: "Toggle Plan mode",
              source: "builtin" as const,
            },
          ]
        : []),
      ...(this.goalsSupported
        ? [
            {
              name: "goal",
              description: "Set, pause, resume, or clear the agent goal",
              source: "builtin" as const,
              argumentHint: "<objective>|pause|resume|clear",
            },
          ]
        : []),
      ...publicCommands([...this.discoveredCommands.values()]),
    ];
  }

  private handleSubagentNotification(
    method: string,
    data: UnknownRecord,
    threadId: string,
  ): void {
    const owner = this.subagentOwners.get(threadId);
    if (!owner) return;
    const turn = this.turns.get(owner.turnId);
    const item = turn?.items.find(
      (candidate) => candidate.id === owner.itemId,
    );
    if (!turn || !item) return;

    const childItems = Array.isArray(item.overtchatChildItems)
      ? [...item.overtchatChildItems]
      : [];
    const upsertChild = (value: UnknownRecord) => {
      const childId = stringOf(value, "id");
      const type = stringOf(value, "type");
      if (!childId || !type) return;
      const child = { ...value, id: childId, type };
      const index = childItems.findIndex(
        (candidate) => stringOf(recordOf(candidate), "id") === childId,
      );
      if (index >= 0) childItems[index] = child;
      else childItems.push(child);
      item.overtchatChildItems = childItems;
      this.registerSubagentThreads(owner, child);
      this.emitTurn(turn);
    };
    const appendChildText = (
      key: string,
      delta: string,
      arrayIndex?: number,
    ) => {
      const childId = stringOf(data, "itemId");
      const child = childItems
        .map(recordOf)
        .find((candidate) => stringOf(candidate, "id") === childId);
      if (!child || !delta) return;
      if (arrayIndex === undefined) {
        child[key] = `${typeof child[key] === "string" ? child[key] : ""}${delta}`;
      } else {
        const parts = Array.isArray(child[key]) ? [...child[key]] : [];
        parts[arrayIndex] =
          `${typeof parts[arrayIndex] === "string" ? parts[arrayIndex] : ""}${delta}`;
        child[key] = parts;
      }
      item.overtchatChildItems = childItems;
      this.emitTurn(turn);
    };

    if (method === "item/started" || method === "item/completed") {
      const child = recordOf(data.item);
      if (child) upsertChild(child);
      return;
    }
    if (method === "item/agentMessage/delta") {
      appendChildText("text", stringOf(data, "delta") ?? "");
      return;
    }
    if (method === "item/reasoning/summaryTextDelta") {
      appendChildText(
        "summary",
        stringOf(data, "delta") ?? "",
        numberOf(data, "summaryIndex") ?? 0,
      );
      return;
    }
    if (method === "item/reasoning/textDelta") {
      appendChildText(
        "content",
        stringOf(data, "delta") ?? "",
        numberOf(data, "contentIndex") ?? 0,
      );
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      appendChildText(
        "aggregatedOutput",
        stringOf(data, "delta") ?? "",
      );
      return;
    }
    if (method === "item/commandExecution/terminalInteraction") {
      const childId = stringOf(data, "itemId");
      const child = childItems
        .map(recordOf)
        .find((candidate) => stringOf(candidate, "id") === childId);
      const stdin = stringOf(data, "stdin");
      if (!child || !stdin) return;
      const interactions = Array.isArray(
        child.overtchatTerminalInteractions,
      )
        ? [...child.overtchatTerminalInteractions]
        : [];
      interactions.push({
        processId: stringOf(data, "processId"),
        stdin,
      });
      child.overtchatTerminalInteractions = interactions;
      item.overtchatChildItems = childItems;
      this.emitTurn(turn);
      return;
    }
    if (method === "item/fileChange/patchUpdated") {
      const childId = stringOf(data, "itemId");
      const child = childItems
        .map(recordOf)
        .find((candidate) => stringOf(candidate, "id") === childId);
      if (child && Array.isArray(data.changes)) {
        child.changes = data.changes;
        item.overtchatChildItems = childItems;
        this.emitTurn(turn);
      }
      return;
    }
    if (method === "item/plan/delta") {
      appendChildText("text", stringOf(data, "delta") ?? "");
      return;
    }
    if (method === "turn/plan/updated") {
      const steps = Array.isArray(data.plan)
        ? data.plan.flatMap((value) => {
            const step = recordOf(value);
            const text = stringOf(step, "step");
            return text ? [text] : [];
          })
        : [];
      upsertChild({
        id: `overtchat:child-plan:${threadId}`,
        type: "plan",
        text: steps.map((step) => `- ${step}`).join("\n"),
      });
      return;
    }
    if (method === "turn/completed") {
      const states = recordOf(item.agentsStates) ?? {};
      const completedTurn = recordOf(data.turn);
      const status = stringOf(completedTurn, "status");
      states[threadId] = {
        status:
          status === "failed"
            ? "errored"
            : status === "interrupted"
              ? "interrupted"
              : "completed",
        message: stringOf(recordOf(completedTurn?.error), "message"),
      };
      item.agentsStates = states;
      this.emitTurn(turn);
    }
  }

  private appendItemText(
    data: UnknownRecord | null,
    key: string,
    delta: string,
  ): void {
    const turnId = stringOf(data, "turnId");
    const itemId = stringOf(data, "itemId");
    const turn = turnId ? this.turns.get(turnId) : undefined;
    const item = turn?.items.find((candidate) => candidate.id === itemId);
    if (!turn || !item || !delta) return;
    item[key] = `${typeof item[key] === "string" ? item[key] : ""}${delta}`;
    this.emitTurn(turn);
  }

  private appendItemArrayText(
    data: UnknownRecord | null,
    key: string,
    index: number,
    delta: string,
  ): void {
    const turnId = stringOf(data, "turnId");
    const itemId = stringOf(data, "itemId");
    const turn = turnId ? this.turns.get(turnId) : undefined;
    const item = turn?.items.find((candidate) => candidate.id === itemId);
    if (!turn || !item || !delta) return;
    const parts = Array.isArray(item[key]) ? [...item[key]] : [];
    parts[index] = `${typeof parts[index] === "string" ? parts[index] : ""}${delta}`;
    item[key] = parts;
    this.emitTurn(turn);
  }

  private emitTurn(turn: CodexTurn): void {
    for (const message of canonicalTurnMessages(turn)) {
      this.emit({ type: "message_update", message });
    }
  }

  private updateTokenUsage(data: UnknownRecord | null): void {
    const threadId = stringOf(data, "threadId");
    if (threadId && threadId !== this.thread?.id) return;
    const tokenUsage = recordOf(data?.tokenUsage);
    const usage = recordOf(tokenUsage?.total);
    if (!usage) return;
    const context = recordOf(tokenUsage?.last);
    const input = numberOf(usage, "inputTokens") ?? 0;
    const output = numberOf(usage, "outputTokens") ?? 0;
    const cacheRead = numberOf(usage, "cachedInputTokens") ?? 0;
    const cacheWrite = numberOf(usage, "cacheWriteInputTokens") ?? 0;
    const total = numberOf(usage, "totalTokens") ?? input + output;
    const contextTokens = numberOf(context, "totalTokens") ?? total;
    const contextWindow = numberOf(
      tokenUsage,
      "modelContextWindow",
    );
    this.stats = {
      ...this.stats,
      sessionFile: this.thread?.path ?? this.thread?.id ?? null,
      sessionId: this.thread?.id ?? null,
      tokens: { input, output, cacheRead, cacheWrite, total },
      ...(contextWindow
        ? {
            contextUsage: {
              tokens: contextTokens,
              contextWindow,
              percent: (contextTokens / contextWindow) * 100,
            },
          }
        : {}),
    };
  }

  private emitConfig(): void {
    this.emit({
      type: "config_update",
      model: { provider: "codex", id: this.selectedModel },
      collaborationMode: this.selectedCollaborationMode,
      collaborationModes: this.availableCollaborationModes(),
      fastModeEnabled: this.fastModeEnabled,
      fastModeAvailable: codexModelSupportsFastMode(this.selectedModel),
      goalsSupported: this.goalsSupported,
      goal: this.goal,
      ...(this.selectedThinking
        ? { thinkingLevel: this.selectedThinking }
        : {}),
    });
  }

  private emit(event: AgentRuntimeEvent): void {
    for (const subscriber of this.subscribers) subscriber(event);
  }

  private createCompletionWaiter<T>(
    timeoutMs: number,
    timeoutMessage: string,
  ): CompletionWaiter<T> {
    let resolvePromise: (value: T) => void = () => {};
    let rejectPromise: (error: Error) => void = () => {};
    let settled = false;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    void promise.catch(() => {});
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectPromise(new Error(timeoutMessage));
    }, timeoutMs);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    return {
      promise,
      resolve: (value) => settle(() => resolvePromise(value)),
      reject: (error) => settle(() => rejectPromise(error)),
      cancel: () =>
        settle(() =>
          rejectPromise(new Error("The Codex completion wait was cancelled.")),
        ),
    };
  }

  private waitForTurnCompletion(
    turnId: string,
    timeoutMs: number,
  ): CompletionWaiter<CodexTurn> {
    const waiter = this.createCompletionWaiter<CodexTurn>(
      timeoutMs,
      `Timed out waiting for Codex turn ${turnId} to finish.`,
    );
    const waiters = this.turnCompletionWaiters.get(turnId) ?? new Set();
    waiters.add(waiter);
    this.turnCompletionWaiters.set(turnId, waiters);
    const cleanUp = () => {
      waiters.delete(waiter);
      if (waiters.size === 0) this.turnCompletionWaiters.delete(turnId);
    };
    void waiter.promise.then(cleanUp, cleanUp);
    return waiter;
  }

  private resolveTurnCompletion(turn: CodexTurn): void {
    for (const waiter of this.turnCompletionWaiters.get(turn.id) ?? []) {
      waiter.resolve(turn);
    }
  }

  private rejectCompletionWaiters(error: Error): void {
    for (const waiters of this.turnCompletionWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.turnCompletionWaiters.clear();
    this.compactionWaiter?.reject(error);
    this.compactionWaiter = null;
    this.isCompacting = false;
  }
}

export function startCodexRuntime(
  target: HostTarget,
  launch: AgentSessionLaunch,
): CodexRuntimeClient {
  return new CodexRuntimeClient(target, launch);
}
