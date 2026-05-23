import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type UIMessage,
} from "ai";
import { webTools, WEB_SEARCH_CITATION_PROMPT } from "@/lib/tools";
import { auth } from "@/lib/auth/server";
import {
  appendMessage,
  deleteMessagesFrom,
  ensureChat,
  touchChat,
} from "@/lib/db/chats";
import { inlineUploads } from "@/lib/db/uploads";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";
import { buildModel } from "@/lib/llm";
import { buildRuntimeContext } from "@/lib/runtime-context";

export const maxDuration = 300;

interface MessageStats {
  contextTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  ttftMs?: number;
  tps?: number;
  finishReason?: string;
}

interface Body {
  messages: UIMessage[];
  modelConfigId: string;
  searchEnabled?: boolean;
  chatId: string;
  projectId?: string | null;
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  temporary?: boolean;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
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
  } = (await req.json()) as Body;

  if (!modelConfigId) return new Response("Missing modelConfigId", { status: 400 });
  if (!messages.length) return new Response("No messages", { status: 400 });
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  const modelConfig = await getModelConfig(modelConfigId);
  if (!modelConfig) return new Response("Model config not found", { status: 404 });

  let resolvedProjectId: string | null;
  if (temporary) {
    resolvedProjectId = projectId ?? null;
  } else {
    const chat = await ensureChat(chatId, userId, projectId ?? null);
    if (!chat) return new Response("Not found", { status: 404 });
    resolvedProjectId = chat.projectId;
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
    abortSignal: req.signal,
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

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
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
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) return;
      if (temporary) return;
      try {
        await appendMessage(
          chatId,
          "assistant",
          responseMessage.parts,
          responseMessage.id,
        );
        await touchChat(chatId);
      } catch (err) {
        console.error("[persist-assistant]", err);
      }
    },
  });
}
