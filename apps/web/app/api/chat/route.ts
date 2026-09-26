import { notifyChatComplete } from "@/lib/notifications/chat";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  ToolLoopAgent,
  toUIMessageStream,
  type LanguageModelUsage,
  type TextStreamPart,
  type ToolSet,
  type PrepareStepFunction,
} from "ai";
import { ChatContextManager } from "@/lib/chat/compaction";
import {
  countTextTokens,
  countToolTokens,
  resolveContextBudget,
} from "@/lib/chat/context-budget";
import {
  createContextCheckpoint,
  restoreContextCheckpoint,
} from "@/lib/chat/context-checkpoint";
import {
  CONTEXT_STATUS_DATA_TYPE,
  isManualCompactionMessage,
  type ContextStatus,
} from "@overtchat/shared";
import { withOutputBudget } from "@/lib/providers/server/output-budget";
import {
  isImageToolPart,
  isGeneratedImage,
  modelSupportsChatReasoningLevel,
} from "@overtchat/shared";
import type { MessageStats } from "@/lib/chat/stats";
import {
  INFERENCE_ACTIVITY_DATA_TYPE,
  type InferenceActivity,
} from "@/lib/chat/inference-activity";
import {
  createImageTools,
  getImageCapability,
  IMAGE_TOOL_PROMPT,
  withImageReferences,
} from "@/lib/images/tools";
import { currentDateSystemPrompt } from "@/lib/chat/current-date";
import {
  assertChatAttachments,
  rejectAttachmentDownloads,
} from "@/lib/chat/attachment-security";
import { projectSystemPrompt } from "@/lib/chat/project-prompt";
import {
  markAnthropicConversationCacheBoundary,
  markAnthropicSystemCacheBoundary,
  promptCacheKeyForChat,
  withOpenAIPromptCacheKey,
} from "@/lib/chat/prompt-cache";
import {
  CHAT_TOOL_ORDER,
  createWebTools,
  WEB_TOOL_NAMES,
  WEB_SEARCH_CITATION_PROMPT,
} from "@/lib/tools";
import { corsHeaders, preflight, withCors } from "@/lib/cors";
import { auth } from "@/lib/auth/server";
import {
  chatRequestFingerprint,
  ChatRequestError,
  parseChatRequest,
} from "@/lib/chat/request";
import {
  ChatHistoryConflictError,
  reconstructPersistedMessages,
} from "@/lib/chat/history";
import { getChat, getMessages } from "@/lib/db/chats";
import { getServerCapability } from "@/lib/db/serverCapabilities";
import {
  clearActiveStreamId,
  commitChatTurn,
  completeChatStream,
  failChatStream,
  getChatGeneration,
  getChatGenerationByRequestId,
  type ChatGenerationRow,
  type CompletedGenerationUsage,
} from "@/lib/db/chatTurns";
import { inlineUploads } from "@/lib/db/uploads";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { getActivePersonalization } from "@/lib/db/personalization";
import { listEffectiveMcpServers } from "@/lib/db/mcpServers";
import { acquireMcpBinding } from "@/lib/mcp/manager";
import { ensureChatTitle } from "@/lib/title";
import { getProvider, modelIconForModel } from "@/lib/providers/catalog";
import {
  memorySystemPrompt,
  userProfileSystemPrompt,
} from "@/lib/personalization/prompt";
import {
  createMemoryTools,
  MEMORY_TOOL_ORDER,
} from "@/lib/personalization/tools";
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
import { resumeChatStreamResponse } from "@/lib/streams/http";

export const maxDuration = 300;

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
  const parsedRequest = await parseChatRequest(req);
  const {
    messages: requestMessages,
    modelConfigId,
    webSearchEnabled,
    forceSearch,
    imageGeneration,
    timeZone,
    chatId,
    projectId,
    action,
    reasoningLevel = "default",
    temporary,
    clientRequestId,
  } = parsedRequest;
  const manualCompaction = action.type === "compact";
  const requestFingerprint = chatRequestFingerprint(parsedRequest);

  if (!temporary) {
    const existingGeneration = await getChatGenerationByRequestId(
      userId,
      clientRequestId,
    );
    if (existingGeneration) {
      return duplicateGenerationResponse({
        req,
        generation: existingGeneration,
        chatId,
        requestFingerprint,
      });
    }
  }

  const modelConfig = await getModelConfig(modelConfigId);
  if (!modelConfig || modelConfig.modelType === "image" || !modelConfig.enabled) {
    return withCors(
      req,
      new Response("Model config not found", { status: 404 }),
    );
  }

  const existingChat = temporary ? null : await getChat(chatId, userId);
  if (existingChat?.kind === "voice") {
    return withCors(
      req,
      new Response("Voice chats must continue through realtime voice", {
        status: 409,
      }),
    );
  }
  let staleStreamId: string | null = null;
  if (existingChat?.activeStreamId) {
    const activeGeneration = await getChatGeneration(
      existingChat.activeStreamId,
      userId,
    );
    if (
      cancelRegistry.has(existingChat.activeStreamId) ||
      activeGeneration?.status === "running"
    ) {
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

  const activePersonalization = temporary
    ? null
    : await getActivePersonalization(userId);
  const personalizationEnabled = activePersonalization !== null;

  let messages = requestMessages;
  let truncateFromMessageId: string | undefined;
  let persistUserMessage = action.type === "submit" || action.type === "retry";
  if (existingChat) {
    try {
      const reconstructed = reconstructPersistedMessages({
        storedMessages: await getMessages(chatId),
        requestMessages,
        action,
      });
      messages = reconstructed.messages;
      truncateFromMessageId = reconstructed.truncateFromMessageId;
      persistUserMessage = reconstructed.persistUserMessage;
    } catch (error) {
      if (error instanceof ChatHistoryConflictError) {
        throw new ChatRequestError(error.message, 409);
      }
      throw error;
    }
  } else if (
    !temporary &&
    (action.type === "edit" || action.type === "regenerate" || manualCompaction)
  ) {
    throw new ChatRequestError(
      "Chat history changed; refresh and try again",
      409,
    );
  }

  // Everything above and through message conversion is read-only. A saved
  // configuration, missing upload, or malformed message therefore cannot
  // truncate an edit/regenerate branch or persist a partial turn.
  const modelCapabilities = resolveModelCapabilities(
    modelConfig.discoveredCapabilities,
    modelConfig.providerId,
    modelConfig.model,
  );
  if (
    reasoningLevel !== "default" &&
    !modelSupportsChatReasoningLevel(modelCapabilities, reasoningLevel)
  ) {
    throw new ChatRequestError(
      `Reasoning level ${reasoningLevel} is unavailable for this model`,
    );
  }
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
      reasoningLevel,
    });
  const chatTools = createWebTools({ userId, supportsImageInput });
  let imageOperationStarted = false;
  const imageTools = createImageTools({
    userId,
    messages,
    supportsImageInput,
    options: imageGeneration,
    onGenerate: () => { imageOperationStarted = true; },
  });
  const imageToolsEnabled =
    modelConfig.toolCallingEnabled !== false && getImageCapability().available;
  if (imageGeneration && !imageToolsEnabled) {
    throw new ChatRequestError("Image generation requires a configured image provider and a chat model with tool calling enabled.");
  }
  assertChatAttachments(messages);
  const restoredContext = restoreContextCheckpoint(messages);
  // Manual markers belong to the transcript, not to the model's conversation.
  restoredContext.messages = restoredContext.messages.filter(
    (message) => !isManualCompactionMessage(message),
  );
  if (
    manualCompaction &&
    restoredContext.messages.filter((message) => message.role === "user")
      .length < 2
  ) {
    throw new ChatRequestError(
      "There are no older turns to compact yet. Continue the conversation first.",
    );
  }
  let contextCheckpoint = restoredContext.checkpoint;
  const inlined = await inlineUploads(
    imageToolsEnabled
      ? withImageReferences(restoredContext.messages, supportsImageInput)
      : restoredContext.messages,
    userId,
  );
  const convertedMessages = await convertToModelMessages(inlined, {
    tools: { ...chatTools, ...imageTools },
    // An intentional stop can persist a tool call before its result arrives.
    // Keep partial text/reasoning, but do not replay an unmatched call.
    ignoreIncompleteToolCalls: true,
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
  if (!contextWindow) {
    throw new ChatRequestError(
      "Set this model's context window in Advanced settings to enable automatic context management.",
    );
  }
  const contextBudget = resolveContextBudget(contextWindow, modelCapabilities);
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
  const systemParts = [
    modelConfig.systemPrompt,
    activePersonalization
      ? userProfileSystemPrompt(activePersonalization.personalization)
      : null,
    activePersonalization
      ? memorySystemPrompt(activePersonalization.memories)
      : null,
    projectSystemPrompt(project),
    webToolsEnabled ? WEB_SEARCH_CITATION_PROMPT : null,
    imageToolsEnabled ? IMAGE_TOOL_PROMPT : null,
    imageGeneration
      ? "The user selected Create image for this turn. Treat their message as an image generation or editing request. Research with available tools or ask a clarifying question first when needed, then use the image tools when ready."
      : null,
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
        clientRequestId,
        requestFingerprint,
        staleStreamId,
        truncateFromMessageId,
        userMessage: persistUserMessage
          ? { id: last.id, parts: last.parts }
          : undefined,
      });

      if (commitResult === "committed") {
        streamClaimed = true;
      } else if (commitResult === "duplicate") {
        cancelRegistry.unregister(streamId);
        await mcpBinding?.release();
        const generation = await getChatGenerationByRequestId(
          userId,
          clientRequestId,
        );
        if (!generation) {
          throw new Error("Idempotent generation claim disappeared");
        }
        return duplicateGenerationResponse({
          req,
          generation,
          chatId,
          requestFingerprint,
        });
      } else if (commitResult === "idempotency-conflict") {
        cancelRegistry.unregister(streamId);
        await mcpBinding?.release();
        return withCors(
          req,
          new Response("Client request ID was already used", { status: 409 }),
        );
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
  const summaryUsages: LanguageModelUsage[] = [];
  let hasUnpricedStep = false;
  let completedGenerationUsage: CompletedGenerationUsage | undefined;
  let streamError: unknown = null;
  let emitContextStatus: ((status: ContextStatus) => void) | undefined;
  const pendingContextStatuses: ContextStatus[] = [];

  try {
    const abortSignal = controller?.signal ?? req.signal;
    const hasMcpTools = Object.keys(mcpTools).length > 0;
    const memoryToolsEnabled = toolCallingEnabled && personalizationEnabled;
    const memoryTools = memoryToolsEnabled ? createMemoryTools(userId) : {};
    const toolSources: ToolSet[] = [
      ...(webToolsEnabled ? [chatTools] : []),
      ...(imageToolsEnabled ? [imageTools] : []),
      ...(memoryToolsEnabled ? [memoryTools] : []),
      ...(hasMcpTools ? [mcpTools] : []),
    ];
    const agentTools: ToolSet =
      toolSources.length === 1
        ? toolSources[0]
        : Object.assign({}, ...toolSources);
    const agentToolNames = Object.keys(agentTools);
    const toolsEnabled = agentToolNames.length > 0;
    const toolOrder = [
      ...(webToolsEnabled ? CHAT_TOOL_ORDER : []),
      ...(memoryToolsEnabled ? MEMORY_TOOL_ORDER : []),
      ...agentToolNames.filter(
        (name) =>
          !(CHAT_TOOL_ORDER as readonly string[]).includes(name) &&
          !(MEMORY_TOOL_ORDER as readonly string[]).includes(name),
      ),
    ];
    const includeProviderActivity = modelConfig.providerId === "llamacpp";
    const streamInclude = includeProviderActivity
      ? { rawChunks: true as const }
      : undefined;
    const contextManager = new ChatContextManager({
      ...contextBudget,
      instructionTokens:
        countTextTokens(system ?? "") +
        (await countToolTokens(agentTools)) +
        32,
      userMessageIds: restoredContext.messages
        .filter((message) => message.role === "user")
        .map((message) => message.id),
      summary: contextCheckpoint?.summary,
      calibration: readContextCalibration(
        messages,
        modelConfig.id,
        modelConfig.model,
      ),
      signal: abortSignal,
      onCheckpoint(boundaryMessageId, summary) {
        contextCheckpoint = createContextCheckpoint(
          messages,
          boundaryMessageId,
          summary,
        );
      },
      onStatus(status) {
        if (emitContextStatus) emitContextStatus(status);
        else pendingContextStatuses.push(status);
      },
      async summarize({ prompt, maxOutputTokens }) {
        const result = await generateText({
          model,
          prompt,
          maxOutputTokens,
          providerOptions: withOutputBudget(
            requestProviderOptions,
            maxOutputTokens,
          ),
          abortSignal,
          maxRetries: 0,
        });
        summaryUsages.push(result.usage);
        const cost = estimateGenerationCost({
          providerId: modelConfig.providerId,
          model: modelConfig.model,
          usage: result.usage,
          pricing: modelConfig.pricing,
        });
        if (cost) stepCosts.push(cost);
        else hasUnpricedStep = true;
        return result.text;
      },
    });
    const prepareStep: PrepareStepFunction<ToolSet> = async ({
      messages: stepMessages,
      steps,
      stepNumber,
    }) => {
      const prepared = await contextManager.prepare(stepMessages, steps);
      return {
        messages:
          promptCacheStrategy?.kind === "anthropic"
            ? markAnthropicConversationCacheBoundary(
                prepared,
                promptCacheStrategy.cacheControl,
              )
            : prepared,
        ...(forceSearch && webToolsEnabled && stepNumber === 0
          ? { activeTools: WEB_TOOL_NAMES, toolChoice: "required" as const }
          : {}),
      };
    };
    const result = manualCompaction
      ? {
          stream: new ReadableStream<TextStreamPart<ToolSet>>({
            async start(writer) {
              writer.enqueue({ type: "start" });
              try {
                await contextManager.prepare(modelMessages, [], true);
                writer.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  rawFinishReason: undefined,
                  // Summary usage is accounted separately below; no answer was generated.
                  totalUsage: {
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    inputTokenDetails: {
                      noCacheTokens: 0,
                      cacheReadTokens: 0,
                      cacheWriteTokens: 0,
                    },
                    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
                  },
                });
              } catch (error) {
                writer.enqueue(
                  abortSignal.aborted
                    ? { type: "abort" }
                    : { type: "error", error },
                );
              } finally {
                writer.close();
              }
            },
          }),
        }
      : toolsEnabled
        ? await new ToolLoopAgent<never, ToolSet>({
            model,
            experimental_download: rejectAttachmentDownloads,
            instructions,
            tools: agentTools,
            toolOrder,
            stopWhen: isStepCount(50),
            toolChoice: "auto",
            prepareStep,
            maxOutputTokens: contextBudget.maxOutputTokens,
            providerOptions: withOutputBudget(
              requestProviderOptions,
              contextBudget.maxOutputTokens,
            ),
            ...(streamInclude ? { include: streamInclude } : {}),
          }).stream({ messages: modelMessages, abortSignal })
        : await new ToolLoopAgent<never, Record<string, never>>({
            model,
            experimental_download: rejectAttachmentDownloads,
            instructions,
            prepareStep,
            maxOutputTokens: contextBudget.maxOutputTokens,
            providerOptions: withOutputBudget(
              requestProviderOptions,
              contextBudget.maxOutputTokens,
            ),
            ...(streamInclude ? { include: streamInclude } : {}),
          }).stream({ messages: modelMessages, abortSignal });

    if (
      !temporary &&
      !manualCompaction &&
      (existingChat?.title ?? null) === null
    ) {
      titlePromise = ensureChatTitle({
        chatId,
        userId,
        fallbackModelConfig: modelConfig,
      });
    }

    const streamContext = temporary ? null : getStreamContext();
    const streamHeaders = corsHeaders(req);
    streamHeaders.set("Content-Encoding", "none");
    let emitInferenceActivity:
      ((activity: InferenceActivity) => void) | undefined;
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
      // A compact-only operation appends a marker rather than continuing the
      // last assistant answer (the SDK's default when history ends in one).
      originalMessages: manualCompaction ? undefined : messages,
      generateMessageId: () => crypto.randomUUID(),
      // This formatter also receives ordinary tool-error parts. Fatal provider
      // errors are recorded by observeChatStream before conversion.
      onError: (error) =>
        error instanceof Error ? error.message : "Something went wrong.",
      messageMetadata: ({ part }) => {
        if (part.type === "start" && manualCompaction)
          return { contextStatus: "manual-compacting" };
        if (part.type === "start" && imageGeneration)
          return { imageGeneration };
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
          const sum = (
            read: (usage: LanguageModelUsage) => number | undefined,
          ) => {
            const values = [part.totalUsage, ...summaryUsages]
              .map(read)
              .filter((value): value is number => value !== undefined);
            return values.length
              ? values.reduce((a, b) => a + b, 0)
              : undefined;
          };
          const estimatedCost =
            stepCosts.length > 0 || hasUnpricedStep || imageOperationStarted
              ? hasUnpricedStep || imageOperationStarted
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
            inputTokens: sum((usage) => usage.inputTokens),
            uncachedInputTokens: sum(
              (usage) => usage.inputTokenDetails.noCacheTokens,
            ),
            outputTokens: sum((usage) => usage.outputTokens),
            cacheReadTokens: sum(
              (usage) => usage.inputTokenDetails.cacheReadTokens,
            ),
            cacheWriteTokens: sum(
              (usage) => usage.inputTokenDetails.cacheWriteTokens,
            ),
            totalTokens: sum((usage) => usage.totalTokens),
            finishReason: part.finishReason,
            ...(estimatedCost ?? {}),
          };
        } else {
          completedGenerationUsage = undefined;
        }

        return {
          ...(!manualCompaction ? { stats } : {}),
          ...(contextCheckpoint ? { contextCheckpoint } : {}),
          ...(contextManager.status
            ? { contextStatus: contextManager.status }
            : {}),
          ...(!manualCompaction && contextManager.estimatedInputTokens > 0
            ? {
                contextEstimate: {
                  modelConfigId: modelConfig.id,
                  model: modelConfig.model,
                  estimatedInputTokens: contextManager.estimatedInputTokens,
                  inputTokens: stepInputTokens,
                },
              }
            : {}),
          ...(imageGeneration ? { imageGeneration } : {}),
        };
      },
      onEnd: async ({ responseMessage, isAborted }) => {
        if (temporary) return;
        // A completed image is a durable result even if the subsequent language
        // model step fails. Preserve it while discarding broken text fragments.
        const savedParts = streamError
          ? responseMessage.parts.filter((part) =>
              isImageToolPart(part) &&
              part.state === "output-available" &&
              Array.isArray(part.output?.images) &&
              part.output.images.some(isGeneratedImage),
            )
          : responseMessage.parts;
        const assistantMessage =
          savedParts.length > 0 ||
          (manualCompaction &&
            !streamError &&
            !isAborted &&
            contextManager.status === "manual-compacted")
            ? {
                id: responseMessage.id,
                parts: savedParts,
                ...(responseMessage.metadata &&
                typeof responseMessage.metadata === "object" &&
                !Array.isArray(responseMessage.metadata)
                  ? {
                      metadata: responseMessage.metadata as Record<
                        string,
                        unknown
                      >,
                    }
                  : {}),
              }
            : undefined;

        try {
          const completed = completeChatStream({
            chatId,
            streamId,
            assistantMessage,
            status: streamError ? "error" : isAborted ? "aborted" : "complete",
            ...(streamError
              ? {
                  error:
                    streamError instanceof Error
                      ? streamError.message
                      : "Provider stream failed.",
                }
              : {}),
            ...(assistantMessage && completedGenerationUsage
              ? { usage: completedGenerationUsage }
              : {}),
          });
          if (
            completed &&
            !manualCompaction &&
            !streamError &&
            !isAborted &&
            assistantMessage
          ) {
            try {
              void notifyChatComplete(
                userId,
                chatId,
                streamId,
                assistantMessage.parts,
              ).catch(() =>
                console.error("[push] Could not send chat notification."),
              );
            } catch {
              console.error("[push] Could not send chat notification.");
            }
          }
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
    const uiStream = createUIMessageStream({
      execute({ writer }) {
        emitContextStatus = (status) =>
          writer.write({
            type: CONTEXT_STATUS_DATA_TYPE,
            data: status,
            transient: true,
          });
        for (const status of pendingContextStatuses) emitContextStatus(status);
        emitInferenceActivity = (activity) => {
          writer.write({
            type: INFERENCE_ACTIVITY_DATA_TYPE,
            data: activity,
            transient: true,
          });
        };
        writer.merge(convertedUiStream);
      },
    });
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
        : consumeStream,
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
        failChatStream({
          chatId,
          streamId,
          error: error instanceof Error ? error.message : "Generation setup failed.",
        });
      } catch (cleanupError) {
        console.error("[clear-active-stream]", cleanupError);
      }
    }
    throw error;
  }
}

function readContextCalibration(
  messages: import("ai").UIMessage[],
  modelConfigId: string,
  model: string,
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i].metadata as
      Record<string, unknown> | undefined;
    const estimate = metadata?.contextEstimate as
      Record<string, unknown> | undefined;
    if (
      messages[i].role === "assistant" &&
      estimate?.modelConfigId === modelConfigId &&
      estimate.model === model &&
      typeof estimate.inputTokens === "number" &&
      typeof estimate.estimatedInputTokens === "number" &&
      estimate.estimatedInputTokens > 0
    ) {
      return Math.max(1, estimate.inputTokens / estimate.estimatedInputTokens);
    }
  }
  return 1;
}

async function duplicateGenerationResponse({
  req,
  generation,
  chatId,
  requestFingerprint,
}: {
  req: Request;
  generation: ChatGenerationRow;
  chatId: string;
  requestFingerprint: string;
}): Promise<Response> {
  if (
    generation.chatId !== chatId ||
    generation.requestFingerprint !== requestFingerprint
  ) {
    return withCors(
      req,
      new Response("Client request ID was already used", { status: 409 }),
    );
  }
  if (generation.status !== "running") {
    return withCors(
      req,
      new Response("Generation request was already completed", { status: 409 }),
    );
  }

  try {
    const response = await resumeChatStreamResponse(req, generation.id);
    if (response) {
      response.headers.set("X-OvertChat-Generation", "resumed");
      return response;
    }
  } catch (error) {
    console.warn("[generation-idempotency] failed to attach duplicate", error);
  }
  return withCors(
    req,
    new Response("Generation is already in progress", { status: 409 }),
  );
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
