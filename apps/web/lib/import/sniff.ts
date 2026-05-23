import type { ImportFormat } from "./types";

/**
 * Detect import format from shape, not filename. Mirrors LibreChat's
 * `getImporter` but with our shape for overtchat's own export.
 */
export function sniffFormat(data: unknown): ImportFormat | null {
  if (!data) return null;

  if (Array.isArray(data)) {
    const first = data[0];
    if (!first || typeof first !== "object") return null;
    if ("mapping" in first && "current_node" in first) return "chatgpt";
    if ("chat_messages" in first && Array.isArray((first as { chat_messages?: unknown }).chat_messages))
      return "claude";
    if ("messages" in first && Array.isArray((first as { messages?: unknown }).messages)) {
      const msgs = (first as { messages: unknown[] }).messages;
      if (msgs[0] && typeof msgs[0] === "object" && "parts" in (msgs[0] as object))
        return "ours";
    }
    return null;
  }

  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    const chat = d.chat as Record<string, unknown> | undefined;
    if (chat && typeof chat === "object") {
      const history = chat.history as Record<string, unknown> | undefined;
      if (history && "messages" in history && "currentId" in history)
        return "openwebui";
    }
    // Single ChatGPT conversation (rare, but supported)
    if ("mapping" in d && "current_node" in d) return "chatgpt";
    // Single overtchat export
    if ("messages" in d && Array.isArray(d.messages)) {
      const msgs = d.messages as unknown[];
      if (msgs[0] && typeof msgs[0] === "object" && "parts" in (msgs[0] as object))
        return "ours";
    }
  }

  return null;
}
