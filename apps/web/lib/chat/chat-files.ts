import type { UIMessage } from "ai";
import {
  codeExecutionFiles,
  isCodeExecutionPart,
  isGeneratedImage,
  isImageToolPart,
} from "@overtchat/shared";

const UPLOAD_URL = /^\/api\/uploads\/([a-zA-Z0-9_-]+)$/;
const MAX_NAME_LENGTH = 180;
/** Names become sandbox paths, and file systems allow 255 bytes per name. */
const MAX_NAME_BYTES = 200;

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
 * Lists the conversation's files in order of first appearance: attachments,
 * files written by code runs, and generated images. Names come from the
 * filename; repeated names get a numbered suffix so the model can refer to
 * every file unambiguously. The same history always yields the same names,
 * which keeps tool references and prompts stable across turns.
 */
export function listChatFiles(messages: readonly UIMessage[]): ChatFile[] {
  const files: ChatFile[] = [];
  const seenIds = new Set<string>();
  const usedNames = new Set<string>();
  const add = (uploadId: string | null, filename: string | undefined, mediaType: string) => {
    if (!uploadId || seenIds.has(uploadId)) return;
    seenIds.add(uploadId);
    const base = safeFilename(filename, mediaType);
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) {
      name = numberedName(base, n);
    }
    usedNames.add(name.toLowerCase());
    files.push({ uploadId, name, mediaType });
  };
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "file") {
        add(uploadIdFromUrl(part.url), part.filename, part.mediaType);
      } else if (isCodeExecutionPart(part)) {
        for (const file of codeExecutionFiles(part)) {
          add(uploadIdFromUrl(file.url), file.name, file.mediaType);
        }
      } else if (
        isImageToolPart(part) &&
        part.state === "output-available" &&
        Array.isArray(part.output?.images)
      ) {
        for (const image of part.output.images) {
          if (isGeneratedImage(image)) {
            add(uploadIdFromUrl(image.url), image.filename, image.mediaType);
          }
        }
      }
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

/**
 * A file name usable as a sandbox path and a tool reference. Applying it to
 * its own result changes nothing, so a saved name lists back unchanged.
 * `reserve` leaves that many characters and bytes free for a numbered suffix.
 */
export function safeFilename(
  filename: string | undefined,
  mediaType: string,
  reserve = 0,
): string {
  let cleaned = (filename ?? "")
    .replace(/[\u0000-\u001f\u007f/\\]|\p{Surrogate}/gu, "_")
    .trim();
  const maxLength = MAX_NAME_LENGTH - reserve;
  const maxBytes = MAX_NAME_BYTES - reserve;
  if (cleaned.length > maxLength || Buffer.byteLength(cleaned) > maxBytes) {
    // Keep a short extension so the type stays recognizable.
    const dot = cleaned.lastIndexOf(".");
    const extension =
      dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
    let stem = "";
    // Whole code points only, so no surrogate pair is split.
    for (const character of cleaned.slice(0, cleaned.length - extension.length)) {
      const next = stem + character;
      if (
        next.length + extension.length > maxLength ||
        Buffer.byteLength(next + extension) > maxBytes
      ) {
        break;
      }
      stem = next;
    }
    cleaned = stem.trim() + extension;
  }
  if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
  return mediaType.startsWith("image/") ? "image" : "file";
}

export function numberedName(name: string, n: number): string {
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
