import { createHash, randomUUID } from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenResponses } from "@ai-sdk/open-responses";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  isStepCount,
  ToolLoopAgent,
  type LanguageModelUsage,
  type ModelMessage,
} from "ai";
import {
  createChatPrepareStep,
  getToolApprovalStatus,
} from "@/lib/chat/tool-policy";
import { markSystemCacheBoundary } from "@/lib/chat/prompt-cache";
import {
  buildRuntimeContext,
  prependRuntimeContext,
  renderRuntimeContext,
  type ChatRuntimeContext,
  type WebSearchMode,
} from "@/lib/runtime-context";
import {
  CHAT_TOOL_ORDER,
  chatTools,
  WEB_SEARCH_CITATION_PROMPT,
} from "@/lib/tools";

type WireFormat = "anthropic" | "gemini" | "open-responses" | "openai-chat";
type RunName = "cold-off" | "warm-off" | "on" | "off-after-toggle";

interface WireRecord {
  run: RunName;
  request: number;
  toolCount: number;
  toolsHash: string;
  instructionsHash: string;
  messagePrefixHash: string;
  toolChoice: string;
}

interface RunResult {
  run: RunName;
  mode: WebSearchMode;
  executedTools: string[];
  requestedTools: string[];
  usage: UsageSummary;
  firstWireRequest: WireRecord;
}

interface UsageSummary {
  input: number | undefined;
  cacheRead: number | undefined;
  cacheWrite: number | undefined;
  noCache: number | undefined;
  output: number | undefined;
}

interface Target {
  label: string;
  model: LanguageModelV4;
  recorder: WireRecorder;
}

class WireRecorder {
  private activeRun: RunName = "cold-off";
  private requestCount = 0;
  readonly records: WireRecord[] = [];

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

  firstFor(run: RunName): WireRecord {
    const record = this.records.find(
      (candidate) => candidate.run === run && candidate.request === 1,
    );
    if (!record) throw new Error(`No wire request captured for ${run}`);
    return record;
  }

  private inspect(
    body: Record<string, unknown>,
    request: number,
  ): WireRecord {
    const tools = Array.isArray(body.tools) ? body.tools : [];
    const toolCount =
      this.format === "gemini"
        ? tools.reduce((count, group) => {
            const declarations = asRecord(group).functionDeclarations;
            return (
              count + (Array.isArray(declarations) ? declarations.length : 0)
            );
          }, 0)
        : tools.length;
    let instructions: unknown;
    let messagePrefix: unknown;
    let toolChoice: unknown;

    switch (this.format) {
      case "gemini": {
        instructions = body.systemInstruction;
        messagePrefix = withoutLast(body.contents);
        const toolConfig = asRecord(body.toolConfig);
        const functionCallingConfig = asRecord(
          toolConfig.functionCallingConfig,
        );
        toolChoice = functionCallingConfig.mode;
        break;
      }
      case "anthropic":
        instructions = body.system;
        messagePrefix = withoutLast(body.messages);
        toolChoice = body.tool_choice;
        break;
      case "open-responses":
        instructions = body.instructions;
        messagePrefix = withoutLast(body.input);
        toolChoice = body.tool_choice;
        break;
      case "openai-chat": {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        instructions = messages.filter(
          (message) => asRecord(message).role === "system",
        );
        messagePrefix = messages.slice(0, -1);
        toolChoice = body.tool_choice;
        break;
      }
    }

    return {
      run: this.activeRun,
      request,
      toolCount,
      toolsHash: hash(tools),
      instructionsHash: hash(instructions ?? null),
      messagePrefixHash: hash(messagePrefix ?? null),
      toolChoice: JSON.stringify(toolChoice ?? null),
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

const runSequence: Array<{
  name: RunName;
  mode: WebSearchMode;
}> = [
  { name: "cold-off", mode: "disabled" },
  { name: "warm-off", mode: "disabled" },
  { name: "on", mode: "required" },
  { name: "off-after-toggle", mode: "disabled" },
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

    for (const run of runSequence) {
      target.recorder.start(run.name);
      const result = await runOnce(target, run.name, run.mode);
      results.push(result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
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
          baseURL:
            "https://bedrock-mantle.us-east-1.api.aws/anthropic/v1",
          authToken: awsBearerToken,
          fetch: recorder.fetch,
        }).messages(modelId),
        recorder,
      });
    }
  }

  for (const modelId of ["openai.gpt-5.6-terra", "openai.gpt-5.6-sol"]) {
    if (!selected(modelId)) continue;
    const recorder = new WireRecorder("open-responses");
    targets.push({
      label: modelId,
      model: createOpenResponses({
        name: "bedrock",
        url: "https://bedrock-mantle.us-east-1.api.aws/openai/v1/responses",
        apiKey: awsBearerToken,
        fetch: recorder.fetch,
      })(modelId),
      recorder,
    });
  }

  const llamaLabel = "llama.cpp/Qwen3.5-122B-A10B";
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
    });
  }

  return targets;
}

async function runOnce(
  target: Target,
  run: RunName,
  mode: WebSearchMode,
): Promise<RunResult> {
  const runtimeContext = buildRuntimeContext({
    turn: runSequence.findIndex((candidate) => candidate.name === run) + 2,
    webSearchMode: mode,
    timeZone: "America/Los_Angeles",
    now: new Date(
      Date.UTC(
        2026,
        6,
        20,
        16,
        runSequence.findIndex((candidate) => candidate.name === run),
      ),
    ),
  });
  const messages = prependRuntimeContext(
    stableMessages(target.label),
    renderRuntimeContext(runtimeContext),
  );
  const executedTools: string[] = [];
  const agent = new ToolLoopAgent<
    never,
    typeof smokeTools,
    ChatRuntimeContext
  >({
    model: target.model,
    instructions: markSystemCacheBoundary({
      role: "system",
      content: [
        "You are running an automated provider integration test.",
        WEB_SEARCH_CITATION_PROMPT,
      ].join("\n\n"),
    }),
    tools: smokeTools,
    toolOrder: CHAT_TOOL_ORDER,
    runtimeContext,
    toolApproval: ({ toolCall, runtimeContext: currentRuntimeContext }) =>
      getToolApprovalStatus(toolCall.toolName, currentRuntimeContext),
    prepareStep: createChatPrepareStep(),
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
  const steps = await streamResult.steps;
  if (steps.length === 0) throw new Error(`${target.label}/${run}: no steps`);

  return {
    run,
    mode,
    executedTools,
    requestedTools,
    usage: summarizeUsage(steps[0].usage),
    firstWireRequest: target.recorder.firstFor(run),
  };
}

function stableMessages(label: string): ModelMessage[] {
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
    {
      role: "user",
      content:
        "Follow runtime_context exactly. If web search is required, call web_search with query exactly 'overtchat cache smoke'. If web search is disabled, do not call any tool and answer exactly WEB_DISABLED.",
    },
  ];
}

const smokeRunId = randomUUID().slice(0, 8);

function assertTarget(target: Target, results: RunResult[]) {
  const offRuns = results.filter((result) => result.mode === "disabled");
  if (offRuns.some((result) => result.executedTools.length > 0)) {
    throw new Error(`${target.label}: a disabled run executed a tool`);
  }
  const on = results.find((result) => result.run === "on");
  if (!on?.executedTools.includes("web_search")) {
    throw new Error(`${target.label}: enabled run did not execute web_search`);
  }

  const wireRecords = results.map((result) => result.firstWireRequest);
  const toolCounts = new Set(wireRecords.map((record) => record.toolCount));
  const toolHashes = new Set(wireRecords.map((record) => record.toolsHash));
  const instructionHashes = new Set(
    wireRecords.map((record) => record.instructionsHash),
  );
  const messagePrefixHashes = new Set(
    wireRecords.map((record) => record.messagePrefixHash),
  );
  if (toolCounts.size !== 1 || !toolCounts.has(2)) {
    throw new Error(
      `${target.label}: full tool registry was not always present`,
    );
  }
  if (toolHashes.size !== 1) {
    throw new Error(`${target.label}: tool definitions changed across toggle`);
  }
  if (instructionHashes.size !== 1) {
    throw new Error(`${target.label}: instructions changed across toggle`);
  }
  if (messagePrefixHashes.size !== 1) {
    throw new Error(
      `${target.label}: pre-runtime messages changed across toggle`,
    );
  }
}

function summarizeUsage(usage: LanguageModelUsage): UsageSummary {
  return {
    input: usage.inputTokens,
    cacheRead: usage.inputTokenDetails.cacheReadTokens,
    cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
    noCache: usage.inputTokenDetails.noCacheTokens,
    output: usage.outputTokens,
  };
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

function withoutLast(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, -1) : [];
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
