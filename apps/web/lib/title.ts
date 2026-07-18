import "server-only";
import { generateText, type UIMessage } from "ai";
import { stripCitationMarkers } from "@/lib/citations";
import { setTitleIfNull } from "@/lib/db/chats";
import type { ModelConfigRow } from "@/lib/db/modelConfigs";
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
  modelConfig,
  userParts,
}: {
  chatId: string;
  modelConfig: TitleModelConfig;
  userParts: UIMessage["parts"];
}): Promise<string | null> {
  try {
    const prompt = buildTitlePromptText(userParts);
    if (!prompt) return null;

    const { model, providerOptions } = createConfiguredLanguageModel({
      providerId: modelConfig.providerId,
      apiFormat: modelConfig.apiFormat,
      baseUrl: modelConfig.baseUrl,
      apiKey: modelConfig.apiKey,
      model: modelConfig.model,
      providerOptions: modelConfig.providerOptions,
    });
    const { text } = await generateText({
      model,
      prompt,
      providerOptions,
      // Do not cap title-task output tokens here. Some reasoning models spend
      // the first output budget on thoughts before emitting final text.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15_000),
    });
    const title = cleanGeneratedTitle(text);
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
    "Generate a concise chat title in 3 to 6 words.",
    "No quotes, no trailing punctuation, no emoji.",
    "Base it on the user's first message.",
    "",
    "User:",
    userText,
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
