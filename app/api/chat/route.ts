import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  wrapLanguageModel,
  extractReasoningMiddleware,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { webTools } from "@/lib/tools";

export const maxDuration = 300;

interface Body {
  messages: UIMessage[];
  baseUrl: string;
  apiKey?: string;
  model: string;
  searchEnabled?: boolean;
}

export async function POST(req: Request) {
  const { messages, baseUrl, apiKey, model, searchEnabled } =
    (await req.json()) as Body;

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
    tools: searchEnabled ? webTools : undefined,
    stopWhen: searchEnabled ? stepCountIs(5) : undefined,
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
