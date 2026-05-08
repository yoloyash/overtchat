import {
  convertToModelMessages,
  streamText,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export const maxDuration = 300;

interface Body {
  messages: UIMessage[];
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export async function POST(req: Request) {
  const { messages, baseUrl, apiKey, model } = (await req.json()) as Body;

  if (!baseUrl || !model) {
    return new Response("Missing baseUrl or model", { status: 400 });
  }

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
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
