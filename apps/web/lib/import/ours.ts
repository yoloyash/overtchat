import { ImportError, type ImportedChat, type ImportedPart } from "./types";

type OursMessage = {
  role?: string;
  parts?: unknown;
  metadata?: unknown;
  createdAt?: number | string;
};

type OursChat = {
  title?: string | null;
  createdAt?: number | string;
  messages?: OursMessage[];
};

type OursExport = {
  format?: unknown;
  chats?: unknown;
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

function normalizeMetadata(
  metadata: unknown,
): Record<string, unknown> | undefined {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return undefined;
  }
  return metadata as Record<string, unknown>;
}

export function importOurs(data: unknown): ImportedChat[] {
  const exportEnvelope = data as OursExport;
  const unwrapped =
    exportEnvelope?.format === "overtchat" &&
    Array.isArray(exportEnvelope.chats)
      ? exportEnvelope.chats
      : data;
  const list: OursChat[] = Array.isArray(unwrapped)
    ? (unwrapped as OursChat[])
    : [unwrapped as OursChat];
  const out: ImportedChat[] = [];
  for (const c of list) {
    if (!c || !Array.isArray(c.messages)) continue;
    const chatCreated = toDate(c.createdAt, new Date());
    const messages = c.messages
      .filter((m): m is OursMessage => Array.isArray(m?.parts))
      .map((m) => {
        const metadata = normalizeMetadata(m.metadata);
        return {
          role: normalizeRole(m.role),
          parts: m.parts as ImportedPart[],
          ...(metadata ? { metadata } : {}),
          createdAt: toDate(m.createdAt, chatCreated),
        };
      });
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
