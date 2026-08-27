import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, eq, lt, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { messages, uploads } from "@/lib/db/schema";
import { MAX_BYTES_IMAGE } from "@/lib/extract";
import { assertFetchedImageContent } from "@/lib/image-content";
import type { CodeExecutionArtifact } from "@overtchat/shared";

type Part = UIMessagePart<UIDataTypes, UITools>;

export type UploadRow = typeof uploads.$inferSelect;

const DB_PATH = process.env.DATABASE_URL ?? "./data/chat.db";
export const UPLOADS_DIR = path.join(path.dirname(DB_PATH), "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export function uploadPath(id: string): string {
  return path.join(UPLOADS_DIR, id);
}

export async function createUpload(row: {
  id: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: "image" | "document" | "text" | "spreadsheet" | "artifact";
  size: number;
  pageCount: number | null;
  extractedText: string | null;
  truncated: boolean;
}): Promise<void> {
  await db.insert(uploads).values(row);
}

export async function getUpload(
  id: string,
  userId: string,
): Promise<UploadRow | null> {
  const [row] = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
    .limit(1);
  return row ?? null;
}

const UPLOAD_URL_PREFIX = "/api/uploads/";

const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export async function storeFetchedImage(input: {
  userId: string;
  filename: string;
  mediaType: string;
  data: Uint8Array;
}): Promise<{ uploadUrl: string }> {
  if (input.data.byteLength > MAX_BYTES_IMAGE) {
    throw new Error("Fetched image exceeds the upload size limit.");
  }
  assertFetchedImageContent(input.data, input.mediaType);

  const id = crypto.randomUUID();
  await fsp.writeFile(uploadPath(id), input.data);
  try {
    await createUpload({
      id,
      userId: input.userId,
      filename: input.filename,
      mediaType: input.mediaType,
      category: "image",
      size: input.data.byteLength,
      pageCount: null,
      extractedText: null,
      truncated: false,
    });
  } catch (error) {
    await fsp.rm(uploadPath(id), { force: true });
    throw error;
  }
  return { uploadUrl: `${UPLOAD_URL_PREFIX}${id}` };
}

type CodeArtifactInput = {
  userId: string;
  filename: string;
  mediaType: string;
  data: Uint8Array;
  image: boolean;
};

export async function storeCodeArtifacts(
  inputs: readonly CodeArtifactInput[],
): Promise<CodeExecutionArtifact[]> {
  const stored = inputs.map((input) => {
    if (input.image) assertFetchedImageContent(input.data, input.mediaType);
    return {
      input,
      id: crypto.randomUUID(),
      filename: sanitizeArtifactFilename(input.filename),
    };
  });

  try {
    await Promise.all(
      stored.map(({ id, input }) => fsp.writeFile(uploadPath(id), input.data)),
    );
    await db.insert(uploads).values(
      stored.map(({ id, filename, input }) => ({
        id,
        userId: input.userId,
        filename,
        mediaType: input.mediaType || "application/octet-stream",
        category: input.image ? ("image" as const) : ("artifact" as const),
        size: input.data.byteLength,
        pageCount: null,
        extractedText: null,
        truncated: false,
      })),
    );
  } catch (error) {
    await Promise.all(
      stored.map(({ id }) => fsp.rm(uploadPath(id), { force: true })),
    );
    throw error;
  }

  return stored.map(({ id, filename, input }) => ({
    kind: input.image ? "image" : "file",
    name: filename,
    mediaType: input.mediaType || "application/octet-stream",
    byteLength: input.data.byteLength,
    url: `${UPLOAD_URL_PREFIX}${id}`,
  }));
}

function sanitizeArtifactFilename(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .trim()
      .slice(0, 180) || "output"
  );
}

export async function readFetchedImage(
  uploadUrl: string,
  userId: string,
): Promise<{ data: Uint8Array; filename: string; mediaType: string } | null> {
  if (!uploadUrl.startsWith(UPLOAD_URL_PREFIX)) return null;
  const id = uploadUrl.slice(UPLOAD_URL_PREFIX.length);
  if (!id || id.includes("/")) return null;

  const row = await getUpload(id, userId);
  if (!row || row.category !== "image") return null;
  try {
    const data = await fsp.readFile(uploadPath(id));
    assertFetchedImageContent(data, row.mediaType);
    return {
      data,
      filename: row.filename,
      mediaType: row.mediaType,
    };
  } catch {
    return null;
  }
}

/**
 * Deletes upload rows (and their disk bytes) older than 24h that no message
 * references. Composer-abandoned uploads never get persisted into a message, so
 * they'd otherwise leak forever.
 */
export async function sweepOrphanedUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS);
  const candidates = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(lt(uploads.createdAt, cutoff));

  for (const { id } of candidates) {
    const needle = `%${UPLOAD_URL_PREFIX}${id}%`;
    const [referenced] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(sql`${messages.parts} LIKE ${needle}`)
      .limit(1);
    if (referenced) continue;
    await db.delete(uploads).where(eq(uploads.id, id));
    await fsp.rm(uploadPath(id), { force: true });
  }
}

/**
 * Rewrites `file` parts that reference our uploads route:
 *   - image uploads → inline `data:` URL so upstream providers can fetch bytes
 *     without going through our auth
 *   - document uploads with extracted text → wrapped in Anthropic-style
 *     <documents>…</documents> XML, prepended before the user's text on the
 *     same message (Anthropic docs: "queries at the end can improve response
 *     quality by up to 30%")
 * Missing/unauthorized uploads are dropped.
 */
export async function inlineUploads(
  uiMessages: UIMessage[],
  userId: string,
): Promise<UIMessage[]> {
  return Promise.all(
    uiMessages.map(async (m) => {
      const docs: Array<{ source: string; text: string; truncated: boolean }> = [];
      const rest: Part[] = [];

      for (const part of m.parts) {
        if (part.type === "file" && part.url.startsWith(UPLOAD_URL_PREFIX)) {
          const id = part.url.slice(UPLOAD_URL_PREFIX.length);
          const row = await getUpload(id, userId);
          if (!row) continue;
          if (row.category === "image") {
            const bytes = await fsp.readFile(uploadPath(id));
            const dataUrl = `data:${row.mediaType};base64,${bytes.toString("base64")}`;
            rest.push({ ...part, url: dataUrl });
          } else if (row.extractedText) {
            docs.push({ source: row.filename, text: row.extractedText, truncated: row.truncated });
          }
          continue;
        }
        rest.push(part);
      }

      if (docs.length === 0) return { ...m, parts: rest };

      const docsXml = renderDocuments(docs);
      const textIdx = rest.findIndex((p) => p.type === "text");
      if (textIdx >= 0) {
        const t = rest[textIdx] as Extract<Part, { type: "text" }>;
        rest[textIdx] = { ...t, text: `${docsXml}\n\n${t.text}` };
      } else {
        rest.unshift({ type: "text", text: docsXml });
      }
      return { ...m, parts: rest };
    }),
  );
}

function renderDocuments(
  docs: Array<{ source: string; text: string; truncated: boolean }>,
): string {
  const items = docs
    .map((d, i) => {
      const src = d.truncated ? `${d.source} (truncated)` : d.source;
      return `<document index="${i + 1}">\n<source>${escapeXml(src)}</source>\n<document_content>\n${d.text}\n</document_content>\n</document>`;
    })
    .join("\n");
  return `<documents>\n${items}\n</documents>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
