import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  ToolLoopAgent,
  toUIMessageStream,
  type TextStreamPart,
} from "ai";
import type { MessageStats } from "@/lib/chat/stats";
import { markSystemCacheBoundary } from "@/lib/chat/prompt-cache";
import {
  chatToolApproval,
  createChatPrepareStep,
  sanitizeToolProviderOptions,
} from "@/lib/chat/tool-policy";
import {
  CHAT_TOOL_ORDER,
  chatTools,
  WEB_SEARCH_CITATION_PROMPT,
} from "@/lib/tools";
import { corsHeaders, preflight, withCors } from "@/lib/cors";
import { auth } from "@/lib/auth/server";
import { ChatRequestError, parseChatRequest } from "@/lib/chat/request";
import { getChat } from "@/lib/db/chats";
import {
  clearActiveStreamId,
  commitChatTurn,
  completeChatStream,
  getChatMessage,
} from "@/lib/db/chatTurns";
import { inlineUploads } from "@/lib/db/uploads";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { generateChatTitle } from "@/lib/title";
import { getProvider, modelIconForModel } from "@/lib/providers/catalog";
import { isProviderConfigurationError } from "@/lib/providers/server/errors";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";
import {
  buildRuntimeContext,
  prependRuntimeContext,
  renderRuntimeContext,
  type ChatRuntimeContext,
} from "@/lib/runtime-context";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { getStreamContext } from "@/lib/streams/context";

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
  const {
    messages,
    modelConfigId,
    searchEnabled,
    timeZone,
    chatId,
    projectId,
    trigger,
    messageId,
    temporary,
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
      trigger === "regenerate-message" ? "assistant" : "user";
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
  const { model, providerOptions } = createConfiguredLanguageModel({
    providerId: modelConfig.providerId,
    apiFormat: modelConfig.apiFormat,
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    model: modelConfig.model,
    providerOptions: modelConfig.providerOptions,
    toolCallingEnabled: modelConfig.toolCallingEnabled,
  });
  const inlined = await inlineUploads(messages, userId);
  const convertedMessages = await convertToModelMessages(inlined);

  const provider = getProvider(modelConfig.providerId);
  const modelIconId =
    modelIconForModel(modelConfig.model) ?? provider.iconId ?? undefined;
  const turnNumber =
    messages.filter((message) => message.role === "user").length - 1;
  const toolCallingEnabled = modelConfig.toolCallingEnabled !== false;
  const runtimeContext = buildRuntimeContext({
    turn: Math.max(0, turnNumber),
    webSearchMode: !toolCallingEnabled
      ? "unavailable"
      : searchEnabled
        ? "required"
        : "disabled",
    timeZone,
  });
  const modelMessages = prependRuntimeContext(
    convertedMessages,
    renderRuntimeContext(runtimeContext),
  );
  const systemParts = [
    project?.instructions,
    modelConfig.systemPrompt,
    toolCallingEnabled ? WEB_SEARCH_CITATION_PROMPT : null,
  ].filter((value): value is string => Boolean(value && value.trim()));
  const system = systemParts.length ? systemParts.join("\n\n") : undefined;
  const instructions = system
    ? markSystemCacheBoundary({ role: "system", content: system })
    : undefined;

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
        truncateFromMessageId: messageId,
        userMessage:
          trigger === "regenerate-message"
            ? undefined
            : { id: last.id, parts: last.parts },
      });

      if (commitResult === "committed") {
        streamClaimed = true;
      } else if (commitResult === "stream-active") {
        cancelRegistry.unregister(streamId);
        return withCors(
          req,
          new Response("Stream already in progress for this chat", {
            status: 409,
          }),
        );
      } else if (commitResult === "history-conflict") {
        cancelRegistry.unregister(streamId);
        return withCors(
          req,
          new Response("Chat history changed; refresh and try again", {
            status: 409,
          }),
        );
      } else {
        cancelRegistry.unregister(streamId);
        return withCors(req, new Response("Not found", { status: 404 }));
      }
    } catch (error) {
      cancelRegistry.unregister(streamId);
      throw error;
    }
  }

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let streamError: unknown = null;

  try {
    const abortSignal = controller?.signal ?? req.signal;
    const result = toolCallingEnabled
      ? await new ToolLoopAgent<never, typeof chatTools, ChatRuntimeContext>({
          model,
          instructions,
          tools: chatTools,
          toolOrder: CHAT_TOOL_ORDER,
          stopWhen: isStepCount(50),
          runtimeContext,
          toolApproval: chatToolApproval,
          prepareStep: createChatPrepareStep(),
          providerOptions: sanitizeToolProviderOptions(providerOptions),
        }).stream({ messages: modelMessages, abortSignal })
      : await new ToolLoopAgent<
          never,
          Record<string, never>,
          ChatRuntimeContext
        >({
          model,
          instructions,
          runtimeContext,
          providerOptions,
        }).stream({ messages: modelMessages, abortSignal });

    if (
      !temporary &&
      (existingChat?.title ?? null) === null &&
      messageId === undefined &&
      userMessageCount === 1
    ) {
      titlePromise = generateChatTitle({
        chatId,
        modelConfig,
        userParts: last.parts,
      });
    }

    const streamContext = temporary ? null : getStreamContext();
    const streamHeaders = corsHeaders(req);
    streamHeaders.set("Content-Encoding", "none");
    const observedStream = observeChatStream(
      result.stream as ReadableStream<TextStreamPart<typeof chatTools>>,
      {
        onFirstToken() {
          firstTokenAt ??= Date.now();
        },
        onError(error) {
          if (streamError === null) {
            streamError = error;
            console.error("[chat-stream]", error);
          }
        },
      },
    );
    const uiStream = toUIMessageStream({
      stream: observedStream,
      tools: toolCallingEnabled ? chatTools : undefined,
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
        const generationMs =
          firstTokenAt === null ? undefined : finishedAt - firstTokenAt;
        const stats: MessageStats = {
          contextTokens: part.totalUsage.inputTokens,
          cacheReadTokens:
            part.totalUsage.inputTokenDetails.cacheReadTokens,
          cacheWriteTokens:
            part.totalUsage.inputTokenDetails.cacheWriteTokens,
          uncachedInputTokens:
            part.totalUsage.inputTokenDetails.noCacheTokens,
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
              }
            : undefined;

        try {
          completeChatStream({ chatId, streamId, assistantMessage });
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
    return createUIMessageStreamResponse({
      stream: uiStream,
      headers: streamHeaders,
      consumeSseStream: streamContext
        ? async ({ stream }) => {
            try {
              await streamContext.createNewResumableStream(
                streamId,
                () => stream,
              );
            } catch (error) {
              console.warn("[resumable-stream] failed to buffer stream", error);
            }
          }
        : undefined,
    });
  } catch (error) {
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
  stream: ReadableStream<TextStreamPart<typeof chatTools>>,
  callbacks: { onFirstToken(): void; onError(error: unknown): void },
): ReadableStream<TextStreamPart<typeof chatTools>> {
  const reader = stream.getReader();

  return new ReadableStream<TextStreamPart<typeof chatTools>>({
    async pull(controller) {
      try {
        const { done, value: part } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        if (
          (part.type === "text-delta" || part.type === "reasoning-delta") &&
          part.text.length > 0
        ) {
          callbacks.onFirstToken();
        } else if (part.type === "error") {
          callbacks.onError(part.error);
        }
        controller.enqueue(part);
      } catch (error) {
        callbacks.onError(error);
        controller.error(error);
      }
    },
    cancel(reason) {
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
