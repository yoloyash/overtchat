import "server-only";
import { generateText, type UIMessage } from "ai";
import { stripCitationMarkers } from "@/lib/citations";
import { setTitleIfNull } from "@/lib/db/chats";
import { tryRecordGenerationUsage } from "@/lib/db/generationUsage";
import type { ModelConfigRow } from "@/lib/db/modelConfigs";
import { estimateGenerationCost } from "@/lib/providers/server/model-cost";
import { createConfiguredLanguageModel } from "@/lib/providers/server/registry";

const TITLE_CONTEXT_CHAR_LIMIT = 2000;
const TITLE_OUTPUT_CHAR_LIMIT = 80;

type TitleModelConfig = Pick<
  ModelConfigRow,
  | "providerId"
  | "apiFormat"
  | "baseUrl"
  | "apiKey"
  | "model"
  | "providerOptions"
>;

export async function generateChatTitle({
  chatId,
  userId,
  modelConfig,
  userParts,
}: {
  chatId: string;
  userId: string;
  modelConfig: TitleModelConfig;
  userParts: UIMessage["parts"];
}): Promise<string | null> {
  try {
    const prompt = buildTitlePromptText(userParts);
    if (!prompt) return null;

    const { model, providerOptions, providerOptionsKey } =
      createConfiguredLanguageModel({
        providerId: modelConfig.providerId,
        apiFormat: modelConfig.apiFormat,
        baseUrl: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
        model: modelConfig.model,
        providerOptions: modelConfig.providerOptions,
      });
    const result = await generateText({
      model,
      prompt,
      providerOptions: {
        ...providerOptions,
        [providerOptionsKey]: {
          ...providerOptions?.[providerOptionsKey],
          reasoningEffort: "none",
        },
      },
      // Do not cap title-task output tokens here. Some reasoning models spend
      // the first output budget on thoughts before emitting final text.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15_000),
    });
    const tokenUsage = [
      result.usage.inputTokens,
      result.usage.inputTokenDetails.noCacheTokens,
      result.usage.outputTokens,
      result.usage.inputTokenDetails.cacheReadTokens,
      result.usage.inputTokenDetails.cacheWriteTokens,
      result.usage.totalTokens,
    ];
    if (tokenUsage.some((value) => value !== undefined)) {
      const estimatedCost = estimateGenerationCost({
        providerId: modelConfig.providerId,
        model: modelConfig.model,
        usage: result.usage,
      });
      tryRecordGenerationUsage({
        id: crypto.randomUUID(),
        userId,
        chatId,
        context: "title",
        occurredAt: new Date(),
        providerId: modelConfig.providerId,
        model: modelConfig.model,
        inputTokens: result.usage.inputTokens,
        uncachedInputTokens: result.usage.inputTokenDetails.noCacheTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens,
        totalTokens: result.usage.totalTokens,
        finishReason: result.finishReason,
        ...(estimatedCost ?? {}),
      });
    }

    const title = cleanGeneratedTitle(result.text);
    return title ? await setTitleIfNull(chatId, title) : null;
  } catch (err) {
    console.error("[title-generation]", err);
    return null;
  }
}

export function buildTitlePromptText(
  userParts: UIMessage["parts"],
): string | null {
  const userText = extractTextForTitle(userParts);
  if (!userText) return null;

  return [
    "### Task:",
    "Generate a short chat title (2-5 words) summarizing the user's message.",
    "",
    "### Guidelines:",
    "- Output ONLY the title text. No prefixes, no markdown formatting elements.",
    '- Never output hashtags, prefixes like "Title:", or quotes.',
    "",
    "### Examples:",
    '- "what\'s the weather in nyc" → Weather in NYC',
    '- "help me write an essay about space" → Space Essay Help',
    '- "hi" → Greeting',
    "",
    "### User Message:",
    "<user_message>",
    userText,
    "</user_message>",
  ].join("\n");
}

export function extractTextForTitle(parts: UIMessage["parts"]): string {
  return parts
    .flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : [],
    )
    .map((text) => stripCitationMarkers(text).trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_CONTEXT_CHAR_LIMIT)
    .trim();
}

export function cleanGeneratedTitle(
  text: string | null | undefined,
): string | null {
  let title = (text ?? "").trim().replace(/\s+/g, " ");
  title = unwrapQuotes(title);
  title = stripTrailingPunctuation(title);
  title = unwrapQuotes(title);
  title = title.slice(0, TITLE_OUTPUT_CHAR_LIMIT).trim();
  title = stripTrailingPunctuation(title);
  title = unwrapQuotes(title);
  return title || null;
}

function unwrapQuotes(text: string): string {
  return text
    .replace(
      /^[\s"'`\u201c\u201d\u2018\u2019]+|[\s"'`\u201c\u201d\u2018\u2019]+$/g,
      "",
    )
    .trim();
}

function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?,;:\u2026]+$/g, "").trim();
}
