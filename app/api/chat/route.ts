import {
  convertToModelMessages,
  streamText,
  generateText,
  stepCountIs,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type LanguageModel,
  type UIMessage,
} from "ai";
import type { JSONValue } from "@ai-sdk/provider";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { webTools } from "@/lib/tools";
import { auth } from "@/lib/auth/server";
import {
  appendMessage,
  deleteMessagesFrom,
  ensureChat,
  setTitleIfNull,
  touchChat,
} from "@/lib/db/chats";
import { inlineUploads } from "@/lib/db/uploads";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { getProject } from "@/lib/db/projects";

export const maxDuration = 300;

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

const PROVIDER_NAME = "user-endpoint";

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

  const provider = createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: modelConfig.baseUrl.replace(/\/$/, ""),
    apiKey: modelConfig.apiKey || "none",
  });

  const wrapped = wrapLanguageModel({
    model: provider.chatModel(modelConfig.model),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });

  const inlined = await inlineUploads(messages, userId);
  const providerOptions = modelConfig.extraBody
    ? { [PROVIDER_NAME]: modelConfig.extraBody as Record<string, JSONValue> }
    : undefined;

  const systemParts = [project?.instructions, modelConfig.systemPrompt].filter(
    (s): s is string => Boolean(s && s.trim()),
  );
  const system = systemParts.length ? systemParts.join("\n\n") : undefined;

  const result = streamText({
    model: wrapped,
    system,
    messages: await convertToModelMessages(inlined),
    tools: searchEnabled ? webTools : undefined,
    stopWhen: searchEnabled ? stepCountIs(10) : undefined,
    abortSignal: req.signal,
    providerOptions,
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
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
        return;
      }
      void maybeGenerateTitle({
        chatId,
        userMsg: last,
        assistantMsg: responseMessage,
        model: wrapped,
      }).catch((err) => console.error("[auto-title]", err));
    },
  });
}

async function maybeGenerateTitle({
  chatId,
  userMsg,
  assistantMsg,
  model,
}: {
  chatId: string;
  userMsg: UIMessage;
  assistantMsg: UIMessage;
  model: LanguageModel;
}) {
  const userText = textOf(userMsg);
  const fallback = userText.trim().slice(0, 40) || "Untitled";
  try {
    const { text } = await generateText({
      model,
      prompt:
        "Summarize this conversation in 3 to 6 words. No quotes, no trailing punctuation, no emoji.\n\n" +
        `User: ${userText}\n\nAssistant: ${textOf(assistantMsg)}`,
    });
    const title = (text || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 80);
    await setTitleIfNull(chatId, title || fallback);
  } catch {
    await setTitleIfNull(chatId, fallback);
  }
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .slice(0, 2000);
}
