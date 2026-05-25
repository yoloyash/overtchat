import { convertToModelMessages, streamText, stepCountIs } from "ai";
import type { ChatRequestBody } from "@overtchat/shared";
import { webTools, WEB_SEARCH_CITATION_PROMPT } from "@/lib/tools";
import { corsHeaders, preflight, withCors } from "@/lib/cors";
import { auth } from "@/lib/auth/server";
import {
  appendMessage,
  deleteMessagesFrom,
  ensureChat,
  getActiveStreamId,
  setActiveStreamId,
  touchChat,
} from "@/lib/db/chats";
import { inlineUploads } from "@/lib/db/uploads";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { buildModel } from "@/lib/llm";
import { buildRuntimeContext } from "@/lib/runtime-context";
import * as cancelRegistry from "@/lib/streams/cancel-registry";
import { getStreamContext } from "@/lib/streams/context";

export const maxDuration = 300;

interface MessageStats {
  contextTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  ttftMs?: number;
  tps?: number;
  finishReason?: string;
}

export function OPTIONS(req: Request) {
  return preflight(req);
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return withCors(req, new Response("Unauthorized", { status: 401 }));
  const userId = session.user.id;

  const {
    messages,
    modelConfigId,
    searchEnabled,
    chatId,
    projectId,
    trigger,
    messageId,
    temporary,
  } = (await req.json()) as ChatRequestBody;

  if (!modelConfigId) return withCors(req, new Response("Missing modelConfigId", { status: 400 }));
  if (!messages.length) return withCors(req, new Response("No messages", { status: 400 }));
  if (!chatId) return withCors(req, new Response("Missing chatId", { status: 400 }));

  const modelConfig = await getModelConfig(modelConfigId);
  if (!modelConfig) return withCors(req, new Response("Model config not found", { status: 404 }));

  let resolvedProjectId: string | null;
  if (temporary) {
    resolvedProjectId = projectId ?? null;
  } else {
    const chat = await ensureChat(chatId, userId, projectId ?? null);
    if (!chat) return withCors(req, new Response("Not found", { status: 404 }));
    resolvedProjectId = chat.projectId;

    const prior = await getActiveStreamId(chatId);
    if (prior) {
      if (cancelRegistry.has(prior)) {
        return withCors(
          req,
          new Response("Stream already in progress for this chat", {
            status: 409,
          }),
        );
      }
      await setActiveStreamId(chatId, null);
    }
  }

  const project = resolvedProjectId
    ? await getProject(resolvedProjectId, userId)
    : null;

  const last = messages[messages.length - 1];
  if (!temporary) {
    if (trigger === "regenerate-message") {
      if (messageId) await deleteMessagesFrom(chatId, messageId);
    } else if (last.role === "user") {
      if (messageId) await deleteMessagesFrom(chatId, messageId);
      await appendMessage(chatId, "user", last.parts, last.id);
    }
    await touchChat(chatId);
  }

  const { model, providerOptions } = buildModel({
    baseUrl: modelConfig.baseUrl,
    apiKey: modelConfig.apiKey,
    model: modelConfig.model,
    extraBody: modelConfig.extraBody,
  });

  const inlined = await inlineUploads(messages, userId);
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;

  const turnNumber = messages.filter((m) => m.role === "user").length - 1;
  const runtimeContext = buildRuntimeContext({
    turn: Math.max(0, turnNumber),
    searchEnabled,
  });
  const systemParts = [
    project?.instructions,
    modelConfig.systemPrompt,
    searchEnabled ? WEB_SEARCH_CITATION_PROMPT : null,
    runtimeContext,
  ].filter((s): s is string => Boolean(s && s.trim()));
  const system = systemParts.length ? systemParts.join("\n\n") : undefined;

  const streamId = crypto.randomUUID();
  const controller = temporary ? null : new AbortController();
  if (controller) cancelRegistry.register(streamId, controller);
  const abortSignal = controller?.signal ?? req.signal;

  const result = streamText({
    model,
    system,
    messages: await convertToModelMessages(inlined),
    tools: searchEnabled ? webTools : undefined,
    stopWhen: searchEnabled ? stepCountIs(50) : undefined,
    prepareStep: searchEnabled
      ? async ({ stepNumber }) =>
          stepNumber === 0 ? { toolChoice: "required" } : {}
      : undefined,
    abortSignal,
    providerOptions,
    onChunk: ({ chunk }) => {
      if (
        firstTokenAt === null &&
        (chunk.type === "text-delta" || chunk.type === "reasoning-delta") &&
        chunk.text.length > 0
      ) {
        firstTokenAt = Date.now();
      }
    },
  });

  const streamHeaders = corsHeaders(req);
  streamHeaders.set("Content-Encoding", "none");
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    headers: streamHeaders,
    consumeSseStream: temporary
      ? undefined
      : async ({ stream }) => {
          await getStreamContext().createNewResumableStream(streamId, () => stream);
          await setActiveStreamId(chatId, streamId);
        },
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;

      const finishedAt = Date.now();
      const outputTokens = part.totalUsage.outputTokens;
      const generationMs =
        firstTokenAt === null ? undefined : finishedAt - firstTokenAt;
      const stats: MessageStats = {
        contextTokens: part.totalUsage.inputTokens,
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
      };

      return { stats };
    },
    onFinish: async ({ responseMessage }) => {
      if (temporary) return;
      try {
        if (responseMessage.parts.length > 0) {
          await appendMessage(
            chatId,
            "assistant",
            responseMessage.parts,
            responseMessage.id,
          );
          await touchChat(chatId);
        }
        await setActiveStreamId(chatId, null);
      } catch (err) {
        console.error("[persist-assistant]", err);
      } finally {
        cancelRegistry.unregister(streamId);
      }
    },
  });
}
