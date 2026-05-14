import "server-only";
import { generateText } from "ai";
import { ensureChat, setTitleIfNull } from "@/lib/db/chats";
import { getModelConfig } from "@/lib/db/modelConfigs";
import { buildModel } from "@/lib/llm";

export async function generateAndPersistTitle({
  chatId,
  userId,
  modelConfigId,
  userText,
  projectId,
}: {
  chatId: string;
  userId: string;
  modelConfigId: string;
  userText: string;
  projectId: string | null;
}): Promise<string | null> {
  const chat = await ensureChat(chatId, userId, projectId);
  if (!chat) return null;
  if (chat.title) return chat.title;

  const modelConfig = await getModelConfig(modelConfigId);
  if (!modelConfig) return null;

  const trimmed = userText.trim().slice(0, 2000);
  const fallback = trimmed.slice(0, 40) || "Untitled";

  let title = fallback;
  try {
    const { model, providerOptions } = buildModel(modelConfig);
    const { text } = await generateText({
      model,
      prompt:
        "Summarize the following user message as a chat title in 3 to 6 words. No quotes, no trailing punctuation, no emoji.\n\n" +
        trimmed,
      providerOptions,
      maxOutputTokens: 20,
      maxRetries: 0,
    });
    const cleaned = (text || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 80);
    if (cleaned) title = cleaned;
  } catch {
    // fall through to fallback
  }

  await setTitleIfNull(chatId, title);
  return title;
}
