import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  ToolLoopAgent,
  toUIMessageStream,
  type LanguageModelUsage,
  type TextStreamPart,
  type ToolSet,
} from "ai";
import type { MessageStats } from "@/lib/chat/stats";
import {
  INFERENCE_ACTIVITY_DATA_TYPE,
  type InferenceActivity,
} from "@/lib/chat/inference-activity";
import { currentDateSystemPrompt } from "@/lib/chat/current-date";
import {
  markAnthropicConversationCacheBoundary,
  markAnthropicSystemCacheBoundary,
  promptCacheKeyForChat,
  withOpenAIPromptCacheKey,
} from "@/lib/chat/prompt-cache";
import {
  CHAT_TOOL_ORDER,
  createCodeExecutionTools,
  createWebTools,
  WEB_TOOL_NAMES,
  WEB_SEARCH_CITATION_PROMPT,
} from "@/lib/tools";
import { corsHeaders, preflight, withCors } from "@/lib/cors";
import { auth } from "@/lib/auth/server";
import { ChatRequestError, parseChatRequest } from "@/lib/chat/request";
import { getChat } from "@/lib/db/chats";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import {
  clearActiveStreamId,
  commitChatTurn,
  completeChatStream,
  getChatMessage,
  type CompletedGenerationUsage,
} from "@/lib/db/chatTurns";
import { inlineUploads } from "@/lib/db/uploads";
import {
  getModelConfig,
  getTaskModelConfig,
} from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { listEffectiveMcpServers } from "@/lib/db/mcpServers";
import { acquireMcpBinding } from "@/lib/mcp/manager";
import { generateChatTitle } from "@/lib/title";
import { getProvider, modelIconForModel } from "@/lib/providers/catalog";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import {
  estimateGenerationCost,
  sumEstimatedGenerationCosts,
  type EstimatedGenerationCost,
} from "@/lib/providers/server/model-cost";
import {
  resolveModelCapabilities,
  resolveModelContextWindow,
} from "@/lib/providers/server/model-catalog";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";
import { readLlamaCppInferenceActivity } from "@/lib/providers/server/llamacpp-activity";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { getStreamContext } from "@/lib/streams/context";

export const maxDuration = 300;

function projectSystemPrompt(project: {
  name: string;
  instructions: string | null;
} | null): string | null {
  if (!project) return null;

  const parts = [
    "Project context:",
    `You are working in a project named ${JSON.stringify(project.name)}.`,
  ];

  if (project.instructions?.trim()) {
    parts.push(
      "",
      "User-provided project instructions:",
      project.instructions,
    );
  }

  return parts.join("\n");
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  try {
    return await handlePost(req);
  } catch (error) {
    return chatErrorResponse(req, error);
  }
}

async function handlePost(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return withCors(req, new Response("Unauthorized", { status: 401 }));
  }
  const userId = session.user.id;
  const {
    messages,
    modelConfigId,
    webSearchEnabled,
    codeExecutionSupported,
    forceSearch,
    timeZone,
    chatId,
    projectId,
    trigger,
    messageId,
    temporary,
    toolContinuation,
  } = await parseChatRequest(req);

  const modelConfig = await getModelConfig(modelConfigId);
  if (!modelConfig || !modelConfig.enabled) {
    return withCors(
      req,
      new Response("Model config not found", { status: 404 }),
    );
  }

  const existingChat = temporary ? null : await getChat(chatId, userId);
  let staleStreamId: string | null = null;
  if (existingChat?.activeStreamId) {
    if (cancelRegistry.has(existingChat.activeStreamId)) {
      return withCors(
        req,
        new Response("Stream already in progress for this chat", {
          status: 409,
        }),
      );
    }
    staleStreamId = existingChat.activeStreamId;
  }

  const resolvedProjectId = existingChat?.projectId ?? projectId ?? null;
  const project = resolvedProjectId
    ? await getProject(resolvedProjectId, userId)
    : null;
  if (resolvedProjectId && !project) {
    return withCors(req, new Response("Project not found", { status: 404 }));
  }

  if (!temporary && messageId) {
    const target = await getChatMessage(chatId, messageId);
    const expectedRole =
      trigger === "regenerate-message" || toolContinuation
        ? "assistant"
        : "user";
    if (!target || target.role !== expectedRole) {
      throw new ChatRequestError(
        "Chat history changed; refresh and try again",
        409,
      );
    }
  }

  // Everything above and through message conversion is read-only. A saved
  // configuration, missing upload, or malformed message therefore cannot
  // truncate an edit/regenerate branch or persist a partial turn.
  const modelCapabilities = resolveModelCapabilities(
    modelConfig.discoveredCapabilities,
    modelConfig.providerId,
    modelConfig.model,
  );
  const supportsImageInput = modelCapabilities?.inputModalities
    ? modelCapabilities.inputModalities.includes("image")
    : modelCapabilities?.attachment !== false;
  const { model, providerOptions, promptCacheStrategy } =
    createConfiguredLanguageModel({
      providerId: modelConfig.providerId,
      apiFormat: modelConfig.apiFormat,
      baseUrl: modelConfig.baseUrl,
      apiKey: modelConfig.apiKey,
      model: modelConfig.model,
      providerOptions: modelConfig.providerOptions,
      toolCallingEnabled: modelConfig.toolCallingEnabled,
      supportsImageInput,
    });
  const chatTools = createWebTools({ userId, supportsImageInput });
  const codeExecutionTools = createCodeExecutionTools();
  const conversionTools = { ...chatTools, ...codeExecutionTools };
  const inlined = await inlineUploads(messages, userId);
  const convertedMessages = await convertToModelMessages(inlined, {
    tools: conversionTools,
  });
  const modelMessages =
    promptCacheStrategy?.kind === "anthropic"
      ? markAnthropicConversationCacheBoundary(
          convertedMessages,
          promptCacheStrategy.cacheControl,
        )
      : convertedMessages;

  const provider = getProvider(modelConfig.providerId);
  const contextWindow = resolveModelContextWindow(
    modelConfig.contextWindow,
    modelConfig.discoveredContextWindow,
    modelConfig.providerId,
    modelConfig.model,
  );
  const modelIconId =
    modelIconForModel(modelConfig.model) ?? provider.iconId ?? undefined;
  const requestProviderOptions =
    promptCacheStrategy?.kind === "openai"
      ? withOpenAIPromptCacheKey(providerOptions, promptCacheKeyForChat(chatId))
      : providerOptions;
  const toolCallingEnabled = modelConfig.toolCallingEnabled !== false;
  const webSearchAvailable =
    getServerCapability("search").provider !== "disabled";
  const webToolsEnabled =
    toolCallingEnabled && webSearchEnabled && webSearchAvailable;
  const codeExecutionEnabled =
    toolCallingEnabled && codeExecutionSupported;
  const systemParts = [
    modelConfig.systemPrompt,
    projectSystemPrompt(project),
    webToolsEnabled ? WEB_SEARCH_CITATION_PROMPT : null,
    currentDateSystemPrompt(timeZone),
  ].filter((value): value is string => Boolean(value && value.trim()));
  const system = systemParts.length ? systemParts.join("\n\n") : undefined;
  const instructions = system
    ? promptCacheStrategy?.kind === "anthropic"
      ? markAnthropicSystemCacheBoundary(
          { role: "system", content: system },
          promptCacheStrategy.cacheControl,
        )
      : { role: "system" as const, content: system }
    : undefined;
  const mcpServers = toolCallingEnabled
    ? await listEffectiveMcpServers(userId, session.user.role)
    : [];
  const mcpBinding =
    mcpServers.length > 0
      ? await acquireMcpBinding({ userId, chatId }, mcpServers)
      : null;
  const mcpTools = mcpBinding?.tools ?? {};

  const last = messages[messages.length - 1];
  const userMessageCount = messages.filter(
    (message) => message.role === "user",
  ).length;
  const streamId = crypto.randomUUID();
  const controller = temporary ? null : new AbortController();
  let streamClaimed = false;
  let titlePromise: Promise<string | null> | null = null;

  if (controller) {
    cancelRegistry.register(streamId, controller);
    try {
      const commitResult = commitChatTurn({
        chatId,
        userId,
        projectId: resolvedProjectId,
        streamId,
        staleStreamId,
        truncateFromMessageId: toolContinuation ? undefined : messageId,
        userMessage:
          trigger === "regenerate-message" || toolContinuation
            ? undefined
            : { id: last.id, parts: last.parts },
        assistantContinuation: toolContinuation
          ? { id: last.id, parts: last.parts }
          : undefined,
      });

      if (commitResult === "committed") {
        streamClaimed = true;
      } else if (commitResult === "stream-active") {
        cancelRegistry.unregister(streamId);
        await mcpBinding?.release();
        return withCors(
          req,
          new Response("Stream already in progress for this chat", {
            status: 409,
          }),
        );
      } else if (commitResult === "history-conflict") {
        cancelRegistry.unregister(streamId);
        await mcpBinding?.release();
        return withCors(
          req,
          new Response("Chat history changed; refresh and try again", {
            status: 409,
          }),
        );
      } else {
        cancelRegistry.unregister(streamId);
        await mcpBinding?.release();
        return withCors(req, new Response("Not found", { status: 404 }));
      }
    } catch (error) {
      cancelRegistry.unregister(streamId);
      await mcpBinding?.release();
      throw error;
    }
  }

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let lastStepUsage: LanguageModelUsage | null = null;
  const stepCosts: EstimatedGenerationCost[] = [];
  let hasUnpricedStep = false;
  let completedGenerationUsage: CompletedGenerationUsage | undefined;
  let streamError: unknown = null;

  try {
    const abortSignal = controller?.signal ?? req.signal;
    const agentTools: ToolSet = {
      ...(codeExecutionEnabled ? codeExecutionTools : {}),
      ...(webToolsEnabled ? chatTools : {}),
      ...mcpTools,
    };
    const agentToolNames = Object.keys(agentTools);
    const toolsEnabled = agentToolNames.length > 0;
    const toolOrder = [
      ...CHAT_TOOL_ORDER.filter((name) => name in agentTools),
      ...agentToolNames.filter(
        (name) => !(CHAT_TOOL_ORDER as readonly string[]).includes(name),
      ),
    ];
    const includeProviderActivity = modelConfig.providerId === "llamacpp";
    const streamInclude = includeProviderActivity
      ? { rawChunks: true as const }
      : undefined;
    const result = toolsEnabled
      ? await new ToolLoopAgent<never, ToolSet>({
          model,
          instructions,
          tools: agentTools,
          toolOrder,
          stopWhen: isStepCount(50),
          toolChoice: "auto",
          prepareStep: forceSearch && webToolsEnabled
            ? ({ stepNumber }) =>
                stepNumber === 0
                  ? {
                      activeTools: WEB_TOOL_NAMES,
                      toolChoice: "required",
                    }
                  : undefined
            : undefined,
          providerOptions: requestProviderOptions,
          ...(streamInclude ? { include: streamInclude } : {}),
        }).stream({ messages: modelMessages, abortSignal })
      : await new ToolLoopAgent<never, Record<string, never>>({
          model,
          instructions,
          providerOptions: requestProviderOptions,
          ...(streamInclude ? { include: streamInclude } : {}),
        }).stream({ messages: modelMessages, abortSignal });

    if (
      !temporary &&
      !toolContinuation &&
      (existingChat?.title ?? null) === null &&
      messageId === undefined &&
      userMessageCount === 1
    ) {
      const titleModelConfig = getTaskModelConfig() ?? modelConfig;
      titlePromise = generateChatTitle({
        chatId,
        userId,
        modelConfig: titleModelConfig,
        userParts: last.parts,
      });
    }

    const streamContext = temporary ? null : getStreamContext();
    const streamHeaders = corsHeaders(req);
    streamHeaders.set("Content-Encoding", "none");
    let emitInferenceActivity:
      | ((activity: InferenceActivity) => void)
      | undefined;
    const observedStream = observeChatStream(
      result.stream as ReadableStream<TextStreamPart<ToolSet>>,
      {
        onFirstToken() {
          firstTokenAt ??= Date.now();
        },
        onFinishStep(usage) {
          lastStepUsage = usage;
          const cost = estimateGenerationCost({
            providerId: modelConfig.providerId,
            model: modelConfig.model,
            usage,
            pricing: modelConfig.pricing,
            cacheWriteTtl:
              promptCacheStrategy?.kind === "anthropic"
                ? (promptCacheStrategy.cacheControl.ttl ?? "5m")
                : undefined,
          });
          if (cost) {
            stepCosts.push(cost);
          } else {
            hasUnpricedStep = true;
          }
        },
        onInferenceActivity(activity) {
          emitInferenceActivity?.(activity);
        },
        onError(error) {
          if (streamError === null) {
            streamError = error;
            console.error("[chat-stream]", error);
          }
        },
        onDone() {
          void mcpBinding?.release();
        },
      },
    );
    const convertedUiStream = toUIMessageStream({
      stream: observedStream,
      tools: toolsEnabled ? agentTools : undefined,
      sendReasoning: true,
      originalMessages: messages,
      generateMessageId: () => crypto.randomUUID(),
      // This formatter also receives ordinary tool-error parts. Fatal provider
      // errors are recorded by observeChatStream before conversion.
      onError: (error) =>
        error instanceof Error ? error.message : "Something went wrong.",
      messageMetadata: ({ part }) => {
        if (part.type !== "finish") return undefined;

        const finishedAt = Date.now();
        const outputTokens = part.totalUsage.outputTokens;
        const contextUsage = lastStepUsage ?? part.totalUsage;
        const stepInputTokens = contextUsage.inputTokens;
        const stepOutputTokens = contextUsage.outputTokens;
        const contextTokens =
          stepInputTokens === undefined && stepOutputTokens === undefined
            ? undefined
            : (stepInputTokens ?? 0) + (stepOutputTokens ?? 0);
        const generationMs =
          firstTokenAt === null ? undefined : finishedAt - firstTokenAt;
        const stats: MessageStats = {
          contextTokens,
          contextWindow,
          cacheReadTokens: part.totalUsage.inputTokenDetails.cacheReadTokens,
          cacheWriteTokens: part.totalUsage.inputTokenDetails.cacheWriteTokens,
          uncachedInputTokens: part.totalUsage.inputTokenDetails.noCacheTokens,
          responseTokens: outputTokens,
          totalTokens: part.totalUsage.totalTokens,
          ttftMs: firstTokenAt === null ? undefined : firstTokenAt - startedAt,
          tps:
            outputTokens === undefined ||
            generationMs === undefined ||
            generationMs <= 0
              ? undefined
              : outputTokens / (generationMs / 1000),
          finishReason: part.finishReason,
          providerLabel: provider.label,
          providerIconId: provider.iconId ?? undefined,
          model: modelConfig.model,
          modelIconId,
        };

        const tokenUsage = [
          part.totalUsage.inputTokens,
          part.totalUsage.inputTokenDetails.noCacheTokens,
          part.totalUsage.outputTokens,
          part.totalUsage.inputTokenDetails.cacheReadTokens,
          part.totalUsage.inputTokenDetails.cacheWriteTokens,
          part.totalUsage.totalTokens,
        ];
        if (tokenUsage.some((value) => value !== undefined)) {
          const estimatedCost =
            stepCosts.length > 0 || hasUnpricedStep
              ? hasUnpricedStep
                ? null
                : sumEstimatedGenerationCosts(stepCosts)
              : estimateGenerationCost({
                  providerId: modelConfig.providerId,
                  model: modelConfig.model,
                  usage: part.totalUsage,
                  pricing: modelConfig.pricing,
                  cacheWriteTtl:
                    promptCacheStrategy?.kind === "anthropic"
                      ? (promptCacheStrategy.cacheControl.ttl ?? "5m")
                      : undefined,
                });
          completedGenerationUsage = {
            occurredAt: new Date(finishedAt),
            providerId: modelConfig.providerId,
            model: modelConfig.model,
            inputTokens: part.totalUsage.inputTokens,
            uncachedInputTokens:
              part.totalUsage.inputTokenDetails.noCacheTokens,
            outputTokens: part.totalUsage.outputTokens,
            cacheReadTokens:
              part.totalUsage.inputTokenDetails.cacheReadTokens,
            cacheWriteTokens:
              part.totalUsage.inputTokenDetails.cacheWriteTokens,
            totalTokens: part.totalUsage.totalTokens,
            finishReason: part.finishReason,
            ...(estimatedCost ?? {}),
          };
        } else {
          completedGenerationUsage = undefined;
        }

        return { stats };
      },
      onEnd: async ({ responseMessage }) => {
        if (temporary) return;
        // Stop is an intentional user abort, so retain whatever the model
        // produced. Provider stream errors still discard broken fragments.
        const assistantMessage =
          !streamError && responseMessage.parts.length > 0
            ? {
                id: responseMessage.id,
                parts: responseMessage.parts,
                metadata:
                  responseMessage.metadata &&
                  typeof responseMessage.metadata === "object" &&
                  !Array.isArray(responseMessage.metadata)
                    ? (responseMessage.metadata as Record<string, unknown>)
                    : undefined,
              }
            : undefined;

        try {
          completeChatStream({
            chatId,
            streamId,
            assistantMessage,
            ...(assistantMessage && completedGenerationUsage
              ? { usage: completedGenerationUsage }
              : {}),
          });
        } catch (error) {
          console.error("[persist-assistant]", error);
          try {
            await clearActiveStreamId(chatId, streamId);
          } catch (cleanupError) {
            console.error("[clear-active-stream]", cleanupError);
          }
        } finally {
          cancelRegistry.unregister(streamId);
          if (titlePromise) await titlePromise;
        }
      },
    });
    const uiStream = includeProviderActivity
      ? createUIMessageStream({
          execute({ writer }) {
            emitInferenceActivity = (activity) => {
              writer.write({
                type: INFERENCE_ACTIVITY_DATA_TYPE,
                data: activity,
                transient: true,
              });
            };
            writer.merge(convertedUiStream);
          },
        })
      : convertedUiStream;
    let resumableSetup: Promise<void> | undefined;
    const response = createUIMessageStreamResponse({
      stream: uiStream,
      headers: streamHeaders,
      consumeSseStream: streamContext
        ? ({ stream }) => {
            resumableSetup = streamContext
              .createNewResumableStream(
                streamId,
                () => stream,
              )
              .then(() => undefined)
              .catch((error: unknown) => {
                console.warn(
                  "[resumable-stream] failed to buffer stream",
                  error,
                );
              });
            return resumableSetup;
          }
        : undefined,
    });

    // createUIMessageStreamResponse invokes consumeSseStream synchronously.
    // Wait until Redis has registered the stream before exposing the response;
    // otherwise an immediate reload can observe active_stream_id first and get
    // a false 204 from the resume endpoint.
    if (resumableSetup) await resumableSetup;
    return response;
  } catch (error) {
    await mcpBinding?.release();
    controller?.abort();
    if (controller) cancelRegistry.unregister(streamId);
    if (streamClaimed) {
      try {
        await clearActiveStreamId(chatId, streamId);
      } catch (cleanupError) {
        console.error("[clear-active-stream]", cleanupError);
      }
    }
    throw error;
  }
}

function observeChatStream(
  stream: ReadableStream<TextStreamPart<ToolSet>>,
  callbacks: {
    onFirstToken(): void;
    onFinishStep(usage: LanguageModelUsage): void;
    onInferenceActivity(activity: InferenceActivity): void;
    onError(error: unknown): void;
    onDone(): void;
  },
): ReadableStream<TextStreamPart<ToolSet>> {
  const reader = stream.getReader();
  let lastActivityPhase: InferenceActivity["phase"] | undefined;
  let lastGenerationActivityAt = 0;

  return new ReadableStream<TextStreamPart<ToolSet>>({
    async pull(controller) {
      try {
        const { done, value: part } = await reader.read();
        if (done) {
          callbacks.onDone();
          controller.close();
          return;
        }

        if (
          (part.type === "text-delta" || part.type === "reasoning-delta") &&
          part.text.length > 0
        ) {
          callbacks.onFirstToken();
        } else if (part.type === "finish-step") {
          callbacks.onFinishStep(part.usage);
        } else if (part.type === "raw") {
          const activity = readLlamaCppInferenceActivity(part.rawValue);
          if (activity) {
            const now = Date.now();
            const phaseChanged = activity.phase !== lastActivityPhase;
            if (
              activity.phase === "prompt" ||
              phaseChanged ||
              now - lastGenerationActivityAt >= 1_000
            ) {
              callbacks.onInferenceActivity(activity);
              lastActivityPhase = activity.phase;
              if (activity.phase === "generation") {
                lastGenerationActivityAt = now;
              }
            }
          }
        } else if (part.type === "error") {
          callbacks.onError(part.error);
        }
        controller.enqueue(part);
      } catch (error) {
        callbacks.onError(error);
        callbacks.onDone();
        controller.error(error);
      }
    },
    cancel(reason) {
      callbacks.onDone();
      return reader.cancel(reason);
    },
  });
}

function chatErrorResponse(req: Request, error: unknown): Response {
  if (error instanceof ChatRequestError) {
    return withCors(req, new Response(error.message, { status: error.status }));
  }
  if (isProviderConfigurationError(error)) {
    console.warn("[chat-config]", error.message);
    return withCors(
      req,
      new Response(`Model configuration error: ${error.message}`, {
        status: 503,
      }),
    );
  }

  console.error("[chat-route]", error);
  return withCors(
    req,
    new Response("Unable to start chat generation", { status: 500 }),
  );
}
