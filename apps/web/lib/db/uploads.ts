import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, eq, lt, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { messages, uploads, chatShareUploads } from "@/lib/db/schema";
import { MAX_BYTES_IMAGE } from "@/lib/extract";
import { allocateTokenBudget } from "@/lib/chat/chat-files";
import { measureTokens, rangeEnd } from "@/lib/chat/document-text";
import { assertFetchedImageContent } from "@/lib/image-content";

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
  category: "image" | "document" | "text" | "spreadsheet";
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
    // Serialize eligibility and deletion with snapshot publication. Otherwise a
    // share created between the reference check and DELETE can lose its bytes.
    const deleted = db.transaction((tx) => {
      const needle = `%${UPLOAD_URL_PREFIX}${id}%`;
      const referenced = tx.select({ id: messages.id }).from(messages)
        .where(sql`${messages.parts} LIKE ${needle}`).get();
      const shared = tx.select({ id: chatShareUploads.uploadId }).from(chatShareUploads)
        .where(eq(chatShareUploads.uploadId, id)).get();
      if (referenced || shared) return false;
      return tx.delete(uploads).where(eq(uploads.id, id)).run().changes > 0;
    }, { behavior: "immediate" });
    if (deleted) await fsp.rm(uploadPath(id), { force: true });
  }
}

export interface InlineUploadOptions {
  /**
   * Tokens of document text included up front in one message, shared across
   * its documents. Omit to include every document in full.
   */
  tokenBudget?: number;
  /** Conversation-wide file names, so prompts match file-tool references. */
  fileNames?: ReadonlyMap<string, string>;
  /** Whether the model can read the remainder of a document with file tools. */
  readerAvailable?: boolean;
  /** Reports each document that was included only in part. */
  onPartial?: (uploadId: string) => void;
}

/**
 * Rewrites `file` parts that reference our uploads route:
 *   - image uploads → inline `data:` URL so upstream providers can fetch bytes
 *     without going through our auth
 *   - document uploads with extracted text → wrapped in Anthropic-style
 *     <documents>…</documents> XML, prepended before the user's text on the
 *     same message (Anthropic docs: "queries at the end can improve response
 *     quality by up to 30%"). A document beyond its share of `tokenBudget`
 *     is cut at a line break, with a note saying where reading resumes.
 * Missing/unauthorized uploads are dropped.
 */
export async function inlineUploads(
  uiMessages: UIMessage[],
  userId: string,
  options: InlineUploadOptions = {},
): Promise<UIMessage[]> {
  return Promise.all(
    uiMessages.map(async (m) => {
      const docs: InlineDocument[] = [];
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
            docs.push({
              uploadId: id,
              source: options.fileNames?.get(id) ?? row.filename,
              text: row.extractedText,
              truncated: row.truncated,
              end: row.extractedText.length,
            });
          }
          continue;
        }
        rest.push(part);
      }

      if (docs.length === 0) return { ...m, parts: rest };

      if (options.tokenBudget !== undefined) {
        const allocations = allocateTokenBudget(
          docs.length,
          options.tokenBudget,
          (index, limit) => measureTokens(docs[index].text, limit, docs[index].uploadId),
        );
        docs.forEach((doc, index) => {
          doc.end = rangeEnd(doc.text, 0, allocations[index], doc.uploadId);
          if (doc.end < doc.text.length) options.onPartial?.(doc.uploadId);
        });
      }

      const docsXml = renderDocuments(docs, options.readerAvailable === true);
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

interface InlineDocument {
  uploadId: string;
  source: string;
  text: string;
  truncated: boolean;
  /** End of the included prefix. */
  end: number;
}

function renderDocuments(docs: InlineDocument[], readerAvailable: boolean): string {
  const items = docs
    .map((d, i) => {
      const src = d.truncated ? `${d.source} (truncated)` : d.source;
      const partial = d.end < d.text.length;
      const content = partial ? d.text.slice(0, d.end) : d.text;
      const status = partial
        ? `\n<document_status>${escapeXml(partialStatus(d, readerAvailable))}</document_status>`
        : "";
      return `<document index="${i + 1}">\n<source>${escapeXml(src)}</source>\n<document_content>\n${content}\n</document_content>${status}\n</document>`;
    })
    .join("\n");
  return `<documents>\n${items}\n</documents>`;
}

function partialStatus(doc: InlineDocument, readerAvailable: boolean): string {
  const included = `Included the first ${doc.end} of ${doc.text.length} characters.`;
  return readerAvailable
    ? `${included} Use read_file with file ${JSON.stringify(doc.source)} and offset ${doc.end} to read further, or search_files to find specific passages.`
    : `${included} The rest of this document is not available in this conversation.`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
