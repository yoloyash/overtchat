import type { RealtimeItem } from "@openai/agents/realtime";
import type { UIMessage } from "ai";
import type { VoiceHistoryItem } from "@overtchat/shared";

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function itemText(item: Extract<RealtimeItem, { type: "message" }>): string {
  return item.content
    .flatMap((part) => {
      if (part.type === "input_text" || part.type === "output_text") {
        return [part.text];
      }
      if (part.type === "input_audio" || part.type === "output_audio") {
        return typeof part.transcript === "string" ? [part.transcript] : [];
      }
      return [];
    })
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n");
}

export function completedVoiceHistory(
  history: readonly RealtimeItem[],
): VoiceHistoryItem[] {
  const items: VoiceHistoryItem[] = [];
  for (const item of history) {
    if (item.type === "message") {
      if (item.role === "system" || item.status === "in_progress") continue;
      const text = itemText(item);
      if (!text) continue;
      items.push({
        type: "message",
        id: item.itemId,
        previousId: item.previousItemId ?? null,
        role: item.role,
        status: item.status,
        text,
      });
      continue;
    }
    if (item.type !== "function_call" || item.status === "in_progress") continue;
    items.push({
      type: "tool",
      id: item.itemId,
      previousId: item.previousItemId ?? null,
      name: item.name,
      status: item.status,
      input: parseJson(item.arguments),
      output: parseJson(item.output),
    });
  }
  return items;
}

function messageId(chatId: string, itemId: string): string {
  return `voice:${chatId}:${itemId}`;
}

function failedToolOutput(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

export function voiceHistoryToUiMessages(
  chatId: string,
  items: readonly VoiceHistoryItem[],
): UIMessage[] {
  return items.map((item) => {
    if (item.type === "message") {
      return {
        id: messageId(chatId, item.id),
        role: item.role,
        parts: [{ type: "text", text: item.text }],
      } satisfies UIMessage;
    }

    const errorText = failedToolOutput(item.output);
    const base = {
      toolCallId: item.id,
      input: item.input,
      ...(errorText
        ? { state: "output-error" as const, errorText }
        : { state: "output-available" as const, output: item.output }),
    };
    const part =
      item.name === "web_search" || item.name === "fetch_url"
        ? { type: `tool-${item.name}` as const, ...base }
        : {
            type: "dynamic-tool" as const,
            toolName: item.name,
            ...base,
          };
    return {
      id: messageId(chatId, item.id),
      role: "assistant",
      parts: [part as UIMessage["parts"][number]],
    } satisfies UIMessage;
  });
}
