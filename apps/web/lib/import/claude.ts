import {
  ImportError,
  type ImportedChat,
  type ImportedMessage,
  type ImportedPart,
} from "./types";

type ClaudeContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; name?: string; input?: unknown }
  | { type: "tool_result"; content?: unknown }
  | { type: string; [k: string]: unknown };

type ClaudeMessage = {
  uuid?: string;
  sender?: "human" | "assistant";
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
};

type ClaudeConversation = {
  uuid?: string;
  name?: string | null;
  created_at?: string;
  chat_messages?: ClaudeMessage[];
};

function parseDate(v: unknown, fallback: Date): Date {
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

function blocksToParts(
  blocks: ClaudeContentBlock[],
  fallbackText: string,
): ImportedPart[] {
  const parts: ImportedPart[] = [];
  const textChunks: string[] = [];
  const reasoningChunks: string[] = [];

  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      textChunks.push(b.text);
    } else if (
      b.type === "thinking" &&
      typeof b.thinking === "string" &&
      b.thinking.trim()
    ) {
      reasoningChunks.push(b.thinking);
    } else if (b.type === "tool_use") {
      const name = typeof b.name === "string" ? b.name : "tool";
      let input = "";
      try {
        input = JSON.stringify(b.input, null, 2);
      } catch {
        input = String(b.input);
      }
      textChunks.push(`[tool: ${name}]\n\`\`\`json\n${input}\n\`\`\``);
    } else if (b.type === "tool_result") {
      const content =
        typeof b.content === "string"
          ? b.content
          : (() => {
              try {
                return JSON.stringify(b.content);
              } catch {
                return String(b.content);
              }
            })();
      if (content) textChunks.push(`[tool result]\n${content}`);
    }
  }

  if (reasoningChunks.length) {
    parts.push({ type: "reasoning", text: reasoningChunks.join("\n\n") });
  }
  const body = textChunks.join("\n\n").trim() || fallbackText.trim();
  if (body) parts.push({ type: "text", text: body });
  return parts;
}

function convertOne(conv: ClaudeConversation): ImportedChat | null {
  if (!Array.isArray(conv.chat_messages)) return null;
  const chatCreated = parseDate(conv.created_at, new Date());
  const messages: ImportedMessage[] = [];

  for (const m of conv.chat_messages) {
    const role: "user" | "assistant" =
      m.sender === "assistant" ? "assistant" : "user";
    const fallback = typeof m.text === "string" ? m.text : "";
    const blocks = Array.isArray(m.content) ? m.content : [];
    const parts = blocks.length
      ? blocksToParts(blocks, fallback)
      : fallback.trim()
        ? [{ type: "text" as const, text: fallback }]
        : [];
    if (!parts.length) continue;
    messages.push({
      role,
      parts,
      createdAt: parseDate(m.created_at, chatCreated),
    });
  }
  if (!messages.length) return null;

  return {
    title: (conv.name ?? "").toString().slice(0, 200) || "Claude conversation",
    createdAt: chatCreated,
    messages,
  };
}

export function importClaude(data: unknown): ImportedChat[] {
  const list: ClaudeConversation[] = Array.isArray(data)
    ? (data as ClaudeConversation[])
    : [data as ClaudeConversation];
  const out: ImportedChat[] = [];
  for (const conv of list) {
    const chat = convertOne(conv);
    if (chat) out.push(chat);
  }
  if (!out.length) throw new ImportError("No usable conversations in Claude export.");
  return out;
}
