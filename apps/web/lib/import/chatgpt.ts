import {
  ImportError,
  type ImportedChat,
  type ImportedMessage,
  type ImportedPart,
} from "./types";

// Only the fields we care about. ChatGPT's real shape has far more.
type ChatGPTMessage = {
  id?: string;
  author?: { role?: string };
  create_time?: number | null;
  content?: {
    content_type?: string;
    parts?: unknown[];
    text?: string;
    thoughts?: { content?: string }[];
    result?: string;
  };
};

type ChatGPTNode = {
  id: string;
  message: ChatGPTMessage | null;
  parent: string | null;
  children: string[];
};

type ChatGPTConversation = {
  title?: string | null;
  create_time?: number | null;
  current_node?: string | null;
  mapping: Record<string, ChatGPTNode>;
};

function tsToDate(t: number | null | undefined, fallback: Date): Date {
  if (typeof t === "number" && Number.isFinite(t)) return new Date(t * 1000);
  return fallback;
}

/** Flatten `content.parts` into plain text. `parts` is sometimes an array of
 * strings, sometimes objects like `{ content_type, text, asset_pointer }`. */
function partsToText(parts: unknown[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      if (p.trim()) out.push(p);
    } else if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      if (typeof o.text === "string" && o.text.trim()) out.push(o.text);
      // Image/audio asset pointers aren't resolvable — leave a marker.
      else if (typeof o.asset_pointer === "string") out.push("[attachment]");
    }
  }
  return out.join("\n").trim();
}

function messageToParts(m: ChatGPTMessage): ImportedPart[] {
  const c = m.content;
  if (!c) return [];
  const parts: ImportedPart[] = [];
  const kind = c.content_type ?? "text";

  if (Array.isArray(c.thoughts) && c.thoughts.length) {
    const text = c.thoughts
      .map((t) => t?.content)
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .join("\n\n");
    if (text) parts.push({ type: "reasoning", text });
  }

  let body = "";
  if (kind === "text" || kind === "multimodal_text") {
    body = Array.isArray(c.parts) ? partsToText(c.parts) : c.text ?? "";
  } else if (kind === "code") {
    const code = Array.isArray(c.parts) ? partsToText(c.parts) : c.text ?? "";
    body = code ? "```\n" + code + "\n```" : "";
  } else if (kind === "execution_output") {
    body = (c.text ?? "").trim();
  } else if (Array.isArray(c.parts)) {
    body = partsToText(c.parts);
  } else if (typeof c.text === "string") {
    body = c.text;
  }

  if (body.trim()) parts.push({ type: "text", text: body });
  return parts;
}

function normalizeRole(r: unknown): "user" | "assistant" | "system" | null {
  if (r === "user" || r === "assistant" || r === "system") return r;
  // "tool" / "function" — drop; we don't have matching part types.
  return null;
}

function walkBranch(
  mapping: Record<string, ChatGPTNode>,
  leafId: string,
): ChatGPTNode[] {
  const path: ChatGPTNode[] = [];
  const seen = new Set<string>();
  let cur: ChatGPTNode | undefined = mapping[leafId];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parent ? mapping[cur.parent] : undefined;
  }
  return path.reverse();
}

function pickLeaf(conv: ChatGPTConversation): string | null {
  if (conv.current_node && conv.mapping[conv.current_node]) return conv.current_node;
  // Fallback: deepest node with children === 0.
  const ids = Object.keys(conv.mapping);
  for (const id of ids) {
    const node = conv.mapping[id];
    if (node.children.length === 0 && node.message) return id;
  }
  return ids[ids.length - 1] ?? null;
}

function convertOne(conv: ChatGPTConversation): ImportedChat | null {
  if (!conv.mapping) return null;
  const leaf = pickLeaf(conv);
  if (!leaf) return null;

  const chatCreated = tsToDate(conv.create_time, new Date());
  const nodes = walkBranch(conv.mapping, leaf);
  const messages: ImportedMessage[] = [];

  for (const node of nodes) {
    const m = node.message;
    if (!m) continue;
    const role = normalizeRole(m.author?.role);
    if (!role) continue;
    const parts = messageToParts(m);
    if (!parts.length) continue;
    messages.push({
      role,
      parts,
      createdAt: tsToDate(m.create_time, chatCreated),
    });
  }
  if (!messages.length) return null;

  return {
    title: (conv.title ?? "").toString().slice(0, 200) || "ChatGPT conversation",
    createdAt: chatCreated,
    messages,
  };
}

export function importChatGPT(data: unknown): ImportedChat[] {
  const list: ChatGPTConversation[] = Array.isArray(data)
    ? (data as ChatGPTConversation[])
    : [data as ChatGPTConversation];
  const out: ImportedChat[] = [];
  for (const conv of list) {
    const chat = convertOne(conv);
    if (chat) out.push(chat);
  }
  if (!out.length) throw new ImportError("No usable conversations in ChatGPT export.");
  return out;
}
