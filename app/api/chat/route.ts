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
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { webTools } from "@/lib/tools";
import { auth } from "@/lib/auth/server";
import {
  appendMessage,
  ensureChat,
  setTitleIfNull,
  touchChat,
} from "@/lib/db/chats";

export const maxDuration = 300;

interface Body {
  messages: UIMessage[];
  baseUrl: string;
  apiKey?: string;
  model: string;
  searchEnabled?: boolean;
  chatId: string;
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const { messages, baseUrl, apiKey, model, searchEnabled, chatId } =
    (await req.json()) as Body;

  if (!baseUrl || !model) {
    return new Response("Missing baseUrl or model", { status: 400 });
  }
  if (!messages.length) {
    return new Response("No messages", { status: 400 });
  }
  if (!chatId) {
    return new Response("Missing chatId", { status: 400 });
  }

  const chat = await ensureChat(chatId, userId);
  if (!chat) return new Response("Not found", { status: 404 });

  const last = messages[messages.length - 1];
  if (last.role === "user") {
    await appendMessage(chatId, "user", last.parts);
  }
  await touchChat(chatId);

  const provider = createOpenAICompatible({
    name: "user-endpoint",
    baseURL: baseUrl.replace(/\/$/, ""),
    apiKey: apiKey || "none",
  });

  const wrapped = wrapLanguageModel({
    model: provider.chatModel(model),
    middleware: extractReasoningMiddleware({ tagName: "think" }),
  });

  const result = streamText({
    model: wrapped,
    messages: await convertToModelMessages(messages),
    tools: searchEnabled ? webTools : undefined,
    stopWhen: searchEnabled ? stepCountIs(10) : undefined,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onFinish: async ({ responseMessage, isAborted }) => {
      if (isAborted) return;
      try {
        await appendMessage(chatId, "assistant", responseMessage.parts);
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
