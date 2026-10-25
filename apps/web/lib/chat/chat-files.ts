import type { UIMessage } from "ai";

const UPLOAD_URL = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/;
const MAX_NAME_LENGTH = 180;

/** An upload attached somewhere in a conversation, under a name unique to it. */
export interface ChatFile {
  uploadId: string;
  name: string;
  mediaType: string;
}

export function uploadIdFromUrl(url: string): string | null {
  return UPLOAD_URL.exec(url)?.[1] ?? null;
}

/**
 * Lists the conversation's uploads in order of first attachment. Names come
 * from the attachment filename; repeated names get a numbered suffix so the
 * model can refer to every file unambiguously. The same history always yields
 * the same names, which keeps tool references and prompts stable across turns.
 */
export function listChatFiles(messages: readonly UIMessage[]): ChatFile[] {
  const files: ChatFile[] = [];
  const seenIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "file") continue;
      const uploadId = uploadIdFromUrl(part.url);
      if (!uploadId || seenIds.has(uploadId)) continue;
      seenIds.add(uploadId);
      const base = safeFilename(part.filename, part.mediaType);
      let name = base;
      for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
        name = numberedName(base, n);
      }
      usedNames.add(name.toLowerCase());
      files.push({ uploadId, name, mediaType: part.mediaType });
    }
  }
  return files;
}

export function isDocumentFile(file: Pick<ChatFile, "mediaType">): boolean {
  return !file.mediaType.startsWith("image/");
}

/** Resolve a model-supplied reference by name (case-insensitive) or upload ID. */
export function findChatFile(
  files: readonly ChatFile[],
  reference: string,
): ChatFile | undefined {
  const wanted = reference.trim();
  if (!wanted) return undefined;
  const lower = wanted.toLowerCase();
  return (
    files.find((file) => file.name.toLowerCase() === lower) ??
    files.find((file) => file.uploadId === wanted)
  );
}

function safeFilename(filename: string | undefined, mediaType: string): string {
  let cleaned = (filename ?? "")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim();
  if (cleaned.length > MAX_NAME_LENGTH) {
    // Keep a short extension so the type stays recognizable.
    const dot = cleaned.lastIndexOf(".");
    const extension =
      dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
    cleaned = cleaned.slice(0, MAX_NAME_LENGTH - extension.length) + extension;
  }
  if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
  return mediaType.startsWith("image/") ? "image" : "file";
}

function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)} (${n})${name.slice(dot)}`
    : `${name} (${n})`;
}

/**
 * Tokens of attachment text included up front in one message. The share is a
 * fixed fraction of the model's input budget, independent of how full the
 * conversation is, so a saved message renders identically on every turn and
 * stays inside provider prompt caches.
 */
export function attachmentTokenBudget(inputTokens: number | undefined): number {
  if (!inputTokens) return 16_000;
  return clamp(Math.floor(inputTokens * 0.3), 1_000, 100_000);
}

/** Tokens returned by one read_file call. */
export function readChunkTokens(inputTokens: number | undefined): number {
  if (!inputTokens) return 8_000;
  return clamp(Math.floor(inputTokens * 0.15), 1_000, 50_000);
}

/**
 * Split a message's attachment budget across its documents. Documents smaller
 * than an equal share keep their full size and pass the remainder to larger
 * ones. `measure(i, limit)` returns document i's token count, or any value
 * above `limit` once the document is known to be larger.
 */
export function allocateTokenBudget(
  count: number,
  total: number,
  measure: (index: number, limit: number) => number,
): number[] {
  const allocations = new Array<number>(count).fill(0);
  let pending = Array.from({ length: count }, (_, index) => index);
  let remaining = Math.max(0, Math.floor(total));
  while (pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const fitting: number[] = [];
    for (const index of pending) {
      const tokens = measure(index, share);
      if (tokens <= share) {
        fitting.push(index);
        allocations[index] = tokens;
      }
    }
    if (fitting.length === 0) {
      for (const index of pending) allocations[index] = share;
      break;
    }
    for (const index of fitting) remaining -= allocations[index];
    pending = pending.filter((index) => !fitting.includes(index));
  }
  return allocations;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
