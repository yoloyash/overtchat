import { ImportError, type ImportedChat, type ImportedPart } from "./types";

type OursMessage = {
  role?: string;
  parts?: unknown;
  createdAt?: number | string;
};

type OursChat = {
  title?: string | null;
  createdAt?: number | string;
  messages?: OursMessage[];
};

function toDate(v: unknown, fallback: Date): Date {
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

function normalizeRole(r: unknown): "user" | "assistant" | "system" {
  return r === "assistant" || r === "system" ? r : "user";
}

export function importOurs(data: unknown): ImportedChat[] {
  const list: OursChat[] = Array.isArray(data) ? (data as OursChat[]) : [data as OursChat];
  const out: ImportedChat[] = [];
  for (const c of list) {
    if (!c || !Array.isArray(c.messages)) continue;
    const chatCreated = toDate(c.createdAt, new Date());
    const messages = c.messages
      .filter((m): m is OursMessage => Array.isArray(m?.parts))
      .map((m) => ({
        role: normalizeRole(m.role),
        parts: m.parts as ImportedPart[],
        createdAt: toDate(m.createdAt, chatCreated),
      }));
    if (!messages.length) continue;
    out.push({
      title: (c.title ?? "").toString().slice(0, 200) || "Imported chat",
      createdAt: chatCreated,
      messages,
    });
  }
  if (!out.length) throw new ImportError("No chats found in export.");
  return out;
}
