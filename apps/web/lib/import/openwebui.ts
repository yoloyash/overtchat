import {
  ImportError,
  type ImportedChat,
  type ImportedMessage,
  type ImportedPart,
} from "./types";

type OWUIMessage = {
  id: string;
  parentId: string | null;
  childrenIds?: string[];
  role?: string;
  content?: string | unknown;
  timestamp?: number;
  files?: unknown[];
};

type OWUIHistory = {
  messages?: Record<string, OWUIMessage>;
  currentId?: string | null;
};

type OWUIChat = {
  id?: string;
  title?: string | null;
  created_at?: number;
  updated_at?: number;
  chat?: {
    title?: string | null;
    history?: OWUIHistory;
    messages?: OWUIMessage[];
  };
};

function numToDate(n: number | undefined, fallback: Date): Date {
  if (typeof n === "number" && Number.isFinite(n)) {
    // OpenWebUI stores seconds. Heuristic: anything > year 5000 is already ms.
    return n > 1e12 ? new Date(n) : new Date(n * 1000);
  }
  return fallback;
}

function normalizeRole(r: unknown): "user" | "assistant" | "system" {
  return r === "assistant" || r === "system" ? r : "user";
}

function walkHistory(history: OWUIHistory): OWUIMessage[] {
  const msgs = history.messages;
  if (!msgs) return [];
  const leaf =
    (history.currentId && msgs[history.currentId]) ||
    Object.values(msgs).find((m) => !(m.childrenIds && m.childrenIds.length));
  if (!leaf) return Object.values(msgs);

  const path: OWUIMessage[] = [];
  const seen = new Set<string>();
  let cur: OWUIMessage | undefined = leaf;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentId ? msgs[cur.parentId] : undefined;
  }
  return path.reverse();
}

function contentToText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && "text" in p) {
          const t = (p as { text?: unknown }).text;
          return typeof t === "string" ? t : "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function convertOne(raw: OWUIChat): ImportedChat | null {
  const inner = raw.chat ?? {};
  const chatCreated = numToDate(raw.created_at, new Date());

  let flat: OWUIMessage[] = [];
  if (inner.history) flat = walkHistory(inner.history);
  else if (Array.isArray(inner.messages)) flat = inner.messages;

  const messages: ImportedMessage[] = [];
  for (const m of flat) {
    const text = contentToText(m.content).trim();
    if (!text) continue;
    const parts: ImportedPart[] = [{ type: "text", text }];
    messages.push({
      role: normalizeRole(m.role),
      parts,
      createdAt: numToDate(m.timestamp, chatCreated),
    });
  }
  if (!messages.length) return null;

  const title =
    (raw.title ?? inner.title ?? "").toString().slice(0, 200) ||
    "OpenWebUI chat";

  return { title, createdAt: chatCreated, messages };
}

export function importOpenWebUI(data: unknown): ImportedChat[] {
  const list: OWUIChat[] = Array.isArray(data)
    ? (data as OWUIChat[])
    : [data as OWUIChat];
  const out: ImportedChat[] = [];
  for (const c of list) {
    const chat = convertOne(c);
    if (chat) out.push(chat);
  }
  if (!out.length) throw new ImportError("No usable chats in OpenWebUI export.");
  return out;
}
