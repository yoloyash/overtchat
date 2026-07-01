import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type ToolSet,
} from "ai";
import type { ChatRequestBody, ModelBrandIconId } from "@overtchat/shared";
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
import { getToolSettings, listEnabledMcpServers } from "@/lib/db/tools";
import { getProject } from "@/lib/db/projects";
import { buildModel } from "@/lib/llm";
import { buildMcpTools, closeMcpClients, type BuiltMcpTools } from "@/lib/mcp";
import {
  modelIconForModel,
  providerIdentityForBaseUrl,
} from "@/lib/providers/meta";
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
  providerLabel?: string;
  providerIconId?: ModelBrandIconId;
  model?: string;
  modelIconId?: ModelBrandIconId;
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
  const [toolSettings, enabledMcpServers] = await Promise.all([
    getToolSettings(),
    listEnabledMcpServers(),
  ]);
  const effectiveSearchEnabled = Boolean(
    searchEnabled && toolSettings.webSearchEnabled,
  );

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
  const providerIdentity = providerIdentityForBaseUrl(modelConfig.baseUrl);
  const modelIconId =
    modelIconForModel(modelConfig.model) ?? providerIdentity.iconId ?? undefined;
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let streamError: unknown = null;

  const turnNumber = messages.filter((m) => m.role === "user").length - 1;
  const runtimeContext = buildRuntimeContext({
    turn: Math.max(0, turnNumber),
    searchEnabled: effectiveSearchEnabled,
  });

  const streamId = crypto.randomUUID();
  const controller = temporary ? null : new AbortController();
  if (controller) cancelRegistry.register(streamId, controller);
  const abortSignal = controller?.signal ?? req.signal;

  let mcpClients: BuiltMcpTools["clients"] = [];
  let result: ReturnType<typeof streamText>;
  try {
    const mcp = await buildMcpTools(enabledMcpServers);
    mcpClients = mcp.clients;
    for (const skipped of mcp.skipped) {
      console.warn(
        `[mcp:${skipped.serverName}] skipped for request: ${skipped.error}`,
      );
    }

    const tools: ToolSet = {};
    if (effectiveSearchEnabled) Object.assign(tools, webTools);
    Object.assign(tools, mcp.tools);
    const hasTools = Object.keys(tools).length > 0;
    const systemParts = [
      project?.instructions,
      modelConfig.systemPrompt,
      effectiveSearchEnabled ? WEB_SEARCH_CITATION_PROMPT : null,
      ...mcp.instructions,
      runtimeContext,
    ].filter((s): s is string => Boolean(s && s.trim()));
    const system = systemParts.length ? systemParts.join("\n\n") : undefined;
    const modelMessages = await convertToModelMessages(inlined);
    result = streamText({
      model,
      system,
      messages: modelMessages,
      tools: hasTools ? tools : undefined,
      stopWhen: hasTools ? stepCountIs(50) : undefined,
      prepareStep: effectiveSearchEnabled
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
      onError: ({ error }) => {
        streamError = error;
        console.error("[chat-stream]", error);
      },
      onAbort: async () => {
        await closeMcpClients(mcpClients);
      },
    });
  } catch (err) {
    if (!temporary) cancelRegistry.unregister(streamId);
    await closeMcpClients(mcpClients);
    throw err;
  }

  const streamHeaders = corsHeaders(req);
  streamHeaders.set("Content-Encoding", "none");
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    headers: streamHeaders,
    onError: (error) =>
      error instanceof Error ? error.message : "Something went wrong.",
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
        providerLabel: providerIdentity.label,
        providerIconId: providerIdentity.iconId ?? undefined,
        model: modelConfig.model,
        modelIconId,
      };

      return { stats };
    },
    onFinish: async ({ responseMessage }) => {
      try {
        if (temporary) return;
        // A turn that errored mid-stream leaves a partial assistant message
        // (e.g. reasoning with no answer). Persisting it would strand a dangling
        // "Thought for Ns" block on reload. Drop it; the client surfaces the
        // error and offers retry.
        if (streamError) {
          await setActiveStreamId(chatId, null);
          return;
        }
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
        if (!temporary) cancelRegistry.unregister(streamId);
        await closeMcpClients(mcpClients);
      }
    },
  });
}
