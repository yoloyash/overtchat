import { createHash, randomUUID } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";
import {
  isStepCount,
  ToolLoopAgent,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import {
  markAnthropicConversationCacheBoundary,
  markAnthropicSystemCacheBoundary,
} from "@/lib/chat/prompt-cache";
import { currentDateSystemPrompt } from "@/lib/chat/current-date";
import {
  CHAT_TOOL_ORDER,
  chatTools,
  WEB_SEARCH_CITATION_PROMPT,
  WEB_TOOL_NAMES,
} from "@/lib/tools";

type WireFormat = "anthropic" | "gemini" | "open-responses" | "openai-chat";
type RunName =
  | "cold-auto"
  | "warm-auto"
  | "forced-search"
  | "forced-direct-url"
  | "auto-after-force";
type NormalizedToolChoice =
  | "auto"
  | "required"
  | "none"
  | "specific"
  | "unspecified";

interface RunSpec {
  name: RunName;
  forceSearch: boolean;
  prompt: string;
}

interface WireRecord {
  run: RunName;
  request: number;
  toolCount: number;
  toolNames: string[];
  toolsHash: string;
  instructionsHash: string;
  promptHash: string;
  promptMessageCount: number;
  toolChoice: NormalizedToolChoice;
  rawToolChoice: string;
  promptCacheKeyHash: string;
  slotId: number | null;
}

interface CapturedWireRecord extends WireRecord {
  promptMessages: unknown[];
}

interface RunResult {
  run: RunName;
  forceSearch: boolean;
  promptHash: string;
  promptMessageCount: number;
  executedTools: string[];
  requestedTools: string[];
  usage: UsageSummary;
  wireRequests: WireRecord[];
}

interface RunOutcome {
  result: RunResult;
  responseMessages: ModelMessage[];
}

interface UsageSummary {
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  noCache: number | null;
  output: number | null;
}

interface CacheExpectations {
  coldWrite?: boolean;
  warmRead?: boolean;
}

interface Target {
  label: string;
  model: LanguageModelV4;
  recorder: WireRecorder;
  anthropicCacheControls?: boolean;
  cacheExpectations?: CacheExpectations;
  expectedSlotId?: number;
  providerOptions?: ProviderOptions;
}

class WireRecorder {
  private activeRun: RunName = "cold-auto";
  private requestCount = 0;
  private readonly records: CapturedWireRecord[] = [];

  constructor(private readonly format: WireFormat) {}

  start(run: RunName) {
    this.activeRun = run;
    this.requestCount = 0;
  }

  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      this.requestCount += 1;
      this.records.push(this.inspect(body, this.requestCount));
    }
    return globalThis.fetch(input, init);
  };

  forRun(run: RunName): WireRecord[] {
    return this.records
      .filter((candidate) => candidate.run === run)
      .map(toPublicWireRecord);
  }

  all(): WireRecord[] {
    return this.records.map(toPublicWireRecord);
  }

  assertFirstPromptsAppendOnly(runNames: RunName[], label: string) {
    const firstRequests = runNames.map((run) => {
      const record = this.records.find(
        (candidate) => candidate.run === run && candidate.request === 1,
      );
      if (!record) throw new Error(`${label}/${run}: no wire request captured`);
      return record;
    });

    for (let index = 1; index < firstRequests.length; index += 1) {
      const previous = firstRequests[index - 1];
      const current = firstRequests[index];
      if (!previous || !current) continue;
      if (!isArrayPrefix(previous.promptMessages, current.promptMessages)) {
        throw new Error(
          `${label}: ${current.run} rewrote prompt content instead of appending`,
        );
      }
    }
  }

  private inspect(
    body: Record<string, unknown>,
    request: number,
  ): CapturedWireRecord {
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolNames = extractToolNames(this.format, tools);
    let instructions: unknown;
    let promptMessages: unknown[];
    let rawToolChoice: unknown;

    switch (this.format) {
      case "gemini": {
        instructions = body.systemInstruction;
        promptMessages = asArray(body.contents);
        const toolConfig = asRecord(body.toolConfig);
        rawToolChoice = asRecord(toolConfig.functionCallingConfig).mode;
        break;
      }
      case "anthropic":
        instructions = body.system;
        promptMessages = asArray(body.messages);
        rawToolChoice = body.tool_choice;
        break;
      case "open-responses": {
        const input = asArray(body.input);
        const inlineInstructions = input.filter((message) => {
          const role = asRecord(message).role;
          return role === "system" || role === "developer";
        });
        instructions = body.instructions ?? inlineInstructions;
        promptMessages = input.filter((message) => {
          const role = asRecord(message).role;
          return role !== "system" && role !== "developer";
        });
        rawToolChoice = body.tool_choice;
        break;
      }
      case "openai-chat": {
        const messages = asArray(body.messages);
        instructions = messages.filter((message) => {
          const role = asRecord(message).role;
          return role === "system" || role === "developer";
        });
        promptMessages = messages.filter((message) => {
          const role = asRecord(message).role;
          return role !== "system" && role !== "developer";
        });
        rawToolChoice = body.tool_choice;
        break;
      }
    }

    const normalizedPrompt = stripCacheControls(promptMessages) as unknown[];
    return {
      run: this.activeRun,
      request,
      toolCount: toolNames.length,
      toolNames,
      toolsHash: hash(tools),
      instructionsHash: hash(instructions ?? null),
      promptHash: hash(normalizedPrompt),
      promptMessageCount: promptMessages.length,
      promptMessages: normalizedPrompt,
      toolChoice: normalizeToolChoice(rawToolChoice),
      rawToolChoice: JSON.stringify(rawToolChoice ?? null),
      promptCacheKeyHash: hash(body.prompt_cache_key ?? null),
      slotId: typeof body.id_slot === "number" ? body.id_slot : null,
    };
  }
}

const smokeTools = {
  web_search: {
    ...chatTools.web_search,
    execute: async ({ query, limit }: { query: string; limit: number }) => [
      {
        link: "https://example.com/cache-smoke",
        title: "Overtchat provider cache smoke",
        snippet: `Deterministic result for ${query} (limit ${limit}).`,
      },
    ],
  },
  fetch_url: {
    ...chatTools.fetch_url,
    execute: async ({ url }: { url: string }) => ({
      title: "Deterministic cache smoke page",
      url,
      content: "This is a local deterministic tool result.",
      wordCount: 8,
    }),
  },
} satisfies typeof chatTools;

const runSequence: RunSpec[] = [
  {
    name: "cold-auto",
    forceSearch: false,
    prompt:
      "No external information is needed. Do not use tools. Answer exactly AUTO_COLD.",
  },
  {
    name: "warm-auto",
    forceSearch: false,
    prompt:
      "No external information is needed. Do not use tools. Answer exactly AUTO_WARM.",
  },
  {
    name: "forced-search",
    forceSearch: true,
    prompt:
      "Search the web for exactly 'overtchat cache smoke'. Use web_search because no URL was supplied, then answer briefly.",
  },
  {
    name: "forced-direct-url",
    forceSearch: true,
    prompt:
      "Open and summarize this exact URL with fetch_url directly: https://example.com/cache-smoke. Do not search for it first.",
  },
  {
    name: "auto-after-force",
    forceSearch: false,
    prompt:
      "No external information is needed. Do not use tools. Answer exactly AUTO_AFTER_FORCE.",
  },
];

async function main() {
  const requestedTargets = new Set(
    (process.env.CACHE_SMOKE_TARGETS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const targets = await createTargets(requestedTargets);
  if (targets.length === 0) {
    throw new Error("CACHE_SMOKE_TARGETS did not match any target");
  }
  const report: Record<string, RunResult[]> = {};

  for (const target of targets) {
    process.stdout.write(`\n[${target.label}]\n`);
    const results: RunResult[] = [];
    let conversation = stablePrefix(target.label);

    for (const run of runSequence) {
      const withUserPrompt = [
        ...conversation,
        { role: "user" as const, content: run.prompt },
      ];
      assertModelMessagesAppendOnly(
        conversation,
        withUserPrompt,
        `${target.label}/${run.name}/user`,
      );

      target.recorder.start(run.name);
      const outcome = await runOnce(target, run, withUserPrompt);
      results.push(outcome.result);
      process.stdout.write(`${JSON.stringify(outcome.result)}\n`);

      const withResponse = [...withUserPrompt, ...outcome.responseMessages];
      assertModelMessagesAppendOnly(
        withUserPrompt,
        withResponse,
        `${target.label}/${run.name}/assistant`,
      );
      conversation = withResponse;
    }

    assertTarget(target, results);
    report[target.label] = results;
  }

  process.stdout.write(`\nCACHE_SMOKE_REPORT=${JSON.stringify(report)}\n`);
}

async function createTargets(
  requestedTargets: ReadonlySet<string>,
): Promise<Target[]> {
  const targets: Target[] = [];
  const selected = (label: string) =>
    requestedTargets.size === 0 || requestedTargets.has(label);
  const selectedWhenConfigured = (label: string, envName: string) =>
    requestedTargets.has(label) ||
    (requestedTargets.size === 0 && Boolean(process.env[envName]));
  const geminiLabels = ["gemini-3.5-flash", "gemini-3.1-pro-preview"];
  const bedrockLabels = [
    "anthropic.claude-sonnet-5",
    "openai.gpt-5.6-terra",
    "openai.gpt-5.6-sol",
  ];
  const geminiApiKey = geminiLabels.some(selected)
    ? requiredEnv("GEMINI_API_KEY")
    : "unused";
  const awsBearerToken = bedrockLabels.some(selected)
    ? requiredEnv("AWS_BEARER_TOKEN")
    : "unused";

  for (const modelId of geminiLabels) {
    if (!selected(modelId)) continue;
    const recorder = new WireRecorder("gemini");
    targets.push({
      label: modelId,
      model: createGoogleGenerativeAI({
        name: "google.generative-ai",
        baseURL: "https://generativelanguage.googleapis.com/v1beta",
        apiKey: geminiApiKey,
        fetch: recorder.fetch,
      }).chat(modelId),
      recorder,
    });
  }

  {
    const recorder = new WireRecorder("anthropic");
    const modelId = "anthropic.claude-sonnet-5";
    if (selected(modelId)) {
      targets.push({
        label: modelId,
        model: createAnthropic({
          name: "bedrock.messages",
          baseURL: "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1",
          authToken: awsBearerToken,
          fetch: recorder.fetch,
        }).messages(modelId),
        recorder,
        anthropicCacheControls: true,
        cacheExpectations: { coldWrite: true, warmRead: true },
      });
    }
  }

  for (const modelId of ["openai.gpt-5.6-terra", "openai.gpt-5.6-sol"]) {
    if (!selected(modelId)) continue;
    const recorder = new WireRecorder("open-responses");
    targets.push({
      label: modelId,
      model: createOpenAI({
        name: "bedrock",
        baseURL: "https://bedrock-mantle.us-east-1.api.aws/openai/v1",
        apiKey: awsBearerToken,
        fetch: recorder.fetch,
      }).responses(modelId),
      recorder,
      cacheExpectations: { coldWrite: true, warmRead: true },
      providerOptions: {
        openai: {
          forceReasoning: true,
          promptCacheKey: `cache-smoke:${smokeRunId}:${modelId}`,
          reasoningEffort: "low",
        },
      },
    });
  }

  {
    const label = "openai-native/gpt-5.6-sol";
    if (selectedWhenConfigured(label, "OPENAI_API_KEY")) {
      const recorder = new WireRecorder("open-responses");
      targets.push({
        label,
        model: createOpenAI({
          apiKey: requiredEnv("OPENAI_API_KEY"),
          fetch: recorder.fetch,
        }).responses("gpt-5.6-sol"),
        recorder,
        cacheExpectations: { coldWrite: true, warmRead: true },
        providerOptions: {
          openai: { promptCacheKey: `cache-smoke:${smokeRunId}` },
        },
      });
    }
  }

  {
    const label = "anthropic-native/claude-sonnet-5";
    if (selectedWhenConfigured(label, "ANTHROPIC_API_KEY")) {
      const recorder = new WireRecorder("anthropic");
      targets.push({
        label,
        model: createAnthropic({
          apiKey: requiredEnv("ANTHROPIC_API_KEY"),
          fetch: recorder.fetch,
        }).messages("claude-sonnet-5"),
        recorder,
        anthropicCacheControls: true,
        cacheExpectations: { coldWrite: true, warmRead: true },
      });
    }
  }

  const llamaLabel = "llama.cpp/local";
  if (selected(llamaLabel)) {
    const llamaHealth = await fetch("http://127.0.0.1:9876/health");
    if (!llamaHealth.ok) {
      throw new Error(`llama.cpp health check failed (${llamaHealth.status})`);
    }
    const llamaModels = (await fetch("http://127.0.0.1:9876/v1/models").then(
      (response) => response.json(),
    )) as { data?: Array<{ id?: string }> };
    const llamaModelId = llamaModels.data?.[0]?.id;
    if (!llamaModelId) throw new Error("llama.cpp returned no model ID");
    const slotId = Number.parseInt(
      process.env.CACHE_SMOKE_LLAMA_SLOT ?? "0",
      10,
    );
    if (!Number.isSafeInteger(slotId) || slotId < 0) {
      throw new Error("CACHE_SMOKE_LLAMA_SLOT must be a non-negative integer");
    }
    const recorder = new WireRecorder("openai-chat");
    targets.push({
      label: llamaLabel,
      model: createOpenAICompatible({
        name: "custom",
        baseURL: "http://127.0.0.1:9876/v1",
        apiKey: "none",
        includeUsage: true,
        fetch: recorder.fetch,
      }).chatModel(llamaModelId),
      recorder,
      expectedSlotId: slotId,
      providerOptions: { custom: { id_slot: slotId } },
    });
  }

  return targets;
}

async function runOnce(
  target: Target,
  run: RunSpec,
  conversation: ModelMessage[],
): Promise<RunOutcome> {
  const messages = target.anthropicCacheControls
    ? markAnthropicConversationCacheBoundary(conversation)
    : conversation;
  const executedTools: string[] = [];
  const instructions = {
    role: "system" as const,
    content: [
      currentDateSystemPrompt("UTC"),
      "You are running an automated provider integration test.",
      WEB_SEARCH_CITATION_PROMPT,
    ].join("\n\n"),
  };
  const agent = new ToolLoopAgent<never, typeof smokeTools>({
    model: target.model,
    instructions: target.anthropicCacheControls
      ? markAnthropicSystemCacheBoundary(instructions)
      : instructions,
    tools: smokeTools,
    toolOrder: CHAT_TOOL_ORDER,
    toolChoice: "auto",
    prepareStep: run.forceSearch
      ? ({ stepNumber }) =>
          stepNumber === 0
            ? {
                activeTools: WEB_TOOL_NAMES,
                toolChoice: "required",
              }
            : undefined
      : undefined,
    providerOptions: target.providerOptions,
    stopWhen: isStepCount(4),
    maxOutputTokens: 384,
    onToolExecutionStart: ({ toolCall }) => {
      executedTools.push(toolCall.toolName);
    },
  });

  const streamResult = await agent.stream({
    messages,
    timeout: { totalMs: 180_000, stepMs: 120_000 },
  });
  const requestedTools: string[] = [];
  for await (const part of streamResult.fullStream) {
    if (part.type === "tool-call") requestedTools.push(part.toolName);
    if (part.type === "error") {
      throw part.error instanceof Error
        ? part.error
        : new Error(String(part.error));
    }
  }
  const [steps, responseMessages] = await Promise.all([
    streamResult.steps,
    streamResult.responseMessages,
  ]);
  if (steps.length === 0) {
    throw new Error(`${target.label}/${run.name}: no steps`);
  }

  return {
    result: {
      run: run.name,
      forceSearch: run.forceSearch,
      promptHash: hash(conversation),
      promptMessageCount: conversation.length,
      executedTools,
      requestedTools,
      usage: summarizeUsage(steps[0].usage),
      wireRequests: target.recorder.forRun(run.name),
    },
    responseMessages,
  };
}

function stablePrefix(label: string): ModelMessage[] {
  const corpusWords = Number.parseInt(
    process.env.CACHE_SMOKE_CORPUS_WORDS ?? "900",
    10,
  );
  if (!Number.isSafeInteger(corpusWords) || corpusWords < 1) {
    throw new Error("CACHE_SMOKE_CORPUS_WORDS must be a positive integer");
  }
  const corpus = Array.from(
    { length: corpusWords },
    (_, index) =>
      `stable-${smokeRunId}-${label.replaceAll(".", "-")}-${index.toString().padStart(4, "0")}`,
  ).join(" ");

  return [
    {
      role: "user",
      content: `Retain this deterministic cache benchmark corpus: ${corpus}`,
    },
    {
      role: "assistant",
      content:
        "I have retained the deterministic cache benchmark corpus for this integration test.",
    },
  ];
}

const smokeRunId = randomUUID().slice(0, 8);

function assertTarget(target: Target, results: RunResult[]) {
  for (const run of runSequence) {
    const result = resultFor(results, run.name, target.label);
    if (run.forceSearch) {
      if (result.wireRequests.length < 2) {
        throw new Error(
          `${target.label}/${run.name}: forced tool call had no automatic follow-up step`,
        );
      }
      if (result.wireRequests[0]?.toolChoice !== "required") {
        throw new Error(
          `${target.label}/${run.name}: first step was not forced`,
        );
      }
      const laterNonAuto = result.wireRequests
        .slice(1)
        .find((record) => record.toolChoice !== "auto");
      if (laterNonAuto) {
        throw new Error(
          `${target.label}/${run.name}: step ${laterNonAuto.request} did not return to automatic tool choice`,
        );
      }
    } else if (
      result.wireRequests.some((record) => record.toolChoice !== "auto")
    ) {
      throw new Error(`${target.label}/${run.name}: automatic run was forced`);
    }
  }

  for (const name of ["cold-auto", "warm-auto", "auto-after-force"] as const) {
    const result = resultFor(results, name, target.label);
    if (result.requestedTools.length > 0 || result.executedTools.length > 0) {
      throw new Error(`${target.label}/${name}: tool-free prompt used a tool`);
    }
  }

  const forcedSearch = resultFor(results, "forced-search", target.label);
  if (forcedSearch.executedTools[0] !== "web_search") {
    throw new Error(
      `${target.label}: forced search did not execute web_search first`,
    );
  }
  const directUrl = resultFor(results, "forced-direct-url", target.label);
  if (directUrl.executedTools[0] !== "fetch_url") {
    throw new Error(
      `${target.label}: direct URL did not execute fetch_url directly`,
    );
  }

  const wireRecords = target.recorder.all();
  const expectedToolNames = [...Object.keys(smokeTools)].sort();
  if (
    wireRecords.some(
      (record) =>
        record.toolCount !== expectedToolNames.length ||
        JSON.stringify([...record.toolNames].sort()) !==
          JSON.stringify(expectedToolNames),
    )
  ) {
    throw new Error(
      `${target.label}: full tool registry was not always present`,
    );
  }
  if (new Set(wireRecords.map((record) => record.toolsHash)).size !== 1) {
    throw new Error(`${target.label}: tool definitions changed between steps`);
  }
  if (
    new Set(wireRecords.map((record) => record.instructionsHash)).size !== 1
  ) {
    throw new Error(`${target.label}: instructions changed between steps`);
  }

  target.recorder.assertFirstPromptsAppendOnly(
    runSequence.map((run) => run.name),
    target.label,
  );

  const promptCacheKeys = new Set(
    wireRecords.map((record) => record.promptCacheKeyHash),
  );
  if (promptCacheKeys.size !== 1) {
    throw new Error(`${target.label}: prompt cache key changed`);
  }
  const slotIds = new Set(wireRecords.map((record) => record.slotId));
  if (slotIds.size !== 1) {
    throw new Error(`${target.label}: slot selection changed`);
  }
  if (target.expectedSlotId != null && !slotIds.has(target.expectedSlotId)) {
    throw new Error(`${target.label}: requests were not pinned to one slot`);
  }

  if (target.cacheExpectations?.coldWrite) {
    const cold = resultFor(results, "cold-auto", target.label);
    if ((cold.usage.cacheWrite ?? 0) <= 0) {
      throw new Error(`${target.label}: cold run did not report a cache write`);
    }
  }
  if (target.cacheExpectations?.warmRead) {
    const warm = resultFor(results, "warm-auto", target.label);
    if ((warm.usage.cacheRead ?? 0) <= 0) {
      throw new Error(`${target.label}: warm automatic run missed the cache`);
    }
  }
}

function resultFor(
  results: RunResult[],
  run: RunName,
  label: string,
): RunResult {
  const result = results.find((candidate) => candidate.run === run);
  if (!result) throw new Error(`${label}: missing ${run} result`);
  return result;
}

function summarizeUsage(usage: LanguageModelUsage): UsageSummary {
  return {
    input: usage.inputTokens ?? null,
    cacheRead: usage.inputTokenDetails.cacheReadTokens ?? null,
    cacheWrite: usage.inputTokenDetails.cacheWriteTokens ?? null,
    noCache: usage.inputTokenDetails.noCacheTokens ?? null,
    output: usage.outputTokens ?? null,
  };
}

function toPublicWireRecord(record: CapturedWireRecord): WireRecord {
  const { promptMessages, ...publicRecord } = record;
  void promptMessages;
  return publicRecord;
}

function extractToolNames(format: WireFormat, tools: unknown[]): string[] {
  if (format === "gemini") {
    return tools.flatMap((group) =>
      asArray(asRecord(group).functionDeclarations)
        .map((declaration) => asRecord(declaration).name)
        .filter((name): name is string => typeof name === "string"),
    );
  }
  if (format === "openai-chat") {
    return tools
      .map((entry) => asRecord(asRecord(entry).function).name)
      .filter((name): name is string => typeof name === "string");
  }
  return tools
    .map((entry) => asRecord(entry).name)
    .filter((name): name is string => typeof name === "string");
}

function normalizeToolChoice(value: unknown): NormalizedToolChoice {
  const raw = typeof value === "string" ? value : asRecord(value).type;
  if (typeof raw !== "string") return "unspecified";
  switch (raw.toLowerCase()) {
    case "auto":
      return "auto";
    case "required":
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
    case "function":
    case "allowed_tools":
      return "specific";
    default:
      return "unspecified";
  }
}

function assertModelMessagesAppendOnly(
  previous: ModelMessage[],
  current: ModelMessage[],
  label: string,
) {
  if (!isArrayPrefix(previous, current)) {
    throw new Error(`${label}: model messages were rewritten`);
  }
}

function isArrayPrefix(previous: unknown[], current: unknown[]): boolean {
  return (
    previous.length <= current.length &&
    hash(previous) === hash(current.slice(0, previous.length))
  );
}

function stripCacheControls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCacheControls);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "cache_control" && key !== "cacheControl")
      .map(([key, nested]) => [key, stripCacheControls(nested)]),
  );
}

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
