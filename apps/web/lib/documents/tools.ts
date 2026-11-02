import "server-only";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import {
  collectDocumentVersions,
  CREATE_DOCUMENT_TOOL_NAME,
  DOCUMENT_TYPES,
  isDocumentOutput,
  MAX_DOCUMENT_LENGTH,
  UPDATE_DOCUMENT_TOOL_NAME,
  type DocumentEdit,
  type DocumentOutput,
  type DocumentType,
} from "@overtchat/shared";
import { findChatFile, isDocumentFile, listChatFiles } from "@/lib/chat/chat-files";
import { getUpload } from "@/lib/db/uploads";

/** Exhaustive document-tool names in deterministic provider order. */
export const DOCUMENT_TOOL_ORDER = Object.freeze([
  CREATE_DOCUMENT_TOOL_NAME,
  UPDATE_DOCUMENT_TOOL_NAME,
] as const);

export const DOCUMENT_TOOL_PROMPT = `Documents:
Use create_document for substantial standalone content the user is likely to keep, revise, reuse or download: reports, articles, plans, letters, longer code files, web pages (html), SVG graphics and Mermaid diagrams. Answer ordinary questions, explanations and short snippets in chat instead.
Put the complete content in the document and do not repeat it in your reply; briefly say what you created or changed. Documents open beside the chat with version history, copy and download.
To change a document, call update_document with its id. Use edits with exact text from the latest version for targeted changes, or content to replace the whole document. Never create a new document to revise an existing one.
To revise a text file the user attached, create a document from it with from_file, then update the document.`;

const MAX_TITLE_LENGTH = 120;
const MAX_EDITS = 50;
// An error shows the model the current text so it can retry precisely.
const MAX_ERROR_CONTENT = 24_000;

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_TITLE_LENGTH);

/**
 * Model-created documents. Versions live in the saved tool results of the
 * conversation, so edit, regenerate and import keep them consistent with the
 * messages that produced them.
 */
export function createDocumentTools({
  userId,
  messages,
}: {
  userId: string;
  messages: readonly UIMessage[];
}) {
  const latest = new Map<string, DocumentOutput>();
  for (const [id, versions] of collectDocumentVersions(messages)) {
    const { title, type, language, version, content } = versions.at(-1)!;
    latest.set(id, {
      id,
      title,
      type,
      ...(language ? { language } : {}),
      version,
      content,
    });
  }
  const files = listChatFiles(messages);
  // Parallel calls in one step apply in order instead of racing on a version.
  let queue: Promise<unknown> = Promise.resolve();
  function serialized<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = queue.then(operation);
    queue = next.catch(() => undefined);
    return next;
  }

  function resolve(reference: string): DocumentOutput {
    const wanted = reference.trim();
    const lower = wanted.toLowerCase();
    const document =
      latest.get(wanted) ??
      [...latest.values()].find((entry) => entry.title.toLowerCase() === lower);
    if (!document) {
      const ids = [...latest.keys()];
      throw new Error(
        ids.length
          ? `No document has the id ${JSON.stringify(reference)}. Documents in this conversation: ${ids.map((id) => JSON.stringify(id)).join(", ")}.`
          : "This conversation has no documents yet. Use create_document first.",
      );
    }
    return document;
  }

  function uniqueId(title: string): string {
    const base =
      title
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)
        .replace(/-+$/g, "") || "document";
    let id = base;
    for (let n = 2; latest.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async function fileText(reference: string): Promise<string> {
    const file = findChatFile(files, reference);
    if (!file || !isDocumentFile(file)) {
      const names = files.filter(isDocumentFile).map((entry) => entry.name);
      throw new Error(
        names.length
          ? `No text file named ${JSON.stringify(reference)} is attached to this conversation. Attached documents: ${names.map((name) => JSON.stringify(name)).join(", ")}.`
          : "No text files are attached to this conversation.",
      );
    }
    const row = await getUpload(file.uploadId, userId);
    if (!row || row.extractedText === null) {
      throw new Error(`${JSON.stringify(file.name)} is no longer available.`);
    }
    if (row.truncated) {
      throw new Error(
        `${JSON.stringify(file.name)} is longer than the extraction limit, so it cannot be copied into a document whole.`,
      );
    }
    return row.extractedText;
  }

  return Object.freeze({
    [CREATE_DOCUMENT_TOOL_NAME]: tool<
      {
        title: string;
        type: DocumentType;
        language?: string;
        content?: string;
        from_file?: string;
      },
      DocumentOutput,
      Record<string, never>
    >({
      description:
        "Create a document the user can view beside the chat, revise, and download. Provide the complete content, or from_file to start from an attached text file.",
      inputSchema: z.object({
        title: titleSchema.describe("Short, descriptive title"),
        type: z
          .enum(DOCUMENT_TYPES)
          .describe(
            "markdown for prose; code for source files (set language); html for a complete web page; svg; mermaid",
          ),
        language: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe("Programming language, for code documents"),
        content: z
          .string()
          .max(MAX_DOCUMENT_LENGTH)
          .optional()
          .describe("The complete document"),
        from_file: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Name of an attached text file to copy as the starting content, instead of content",
          ),
      }),
      execute: ({ title, type, language, content, from_file }) =>
        serialized(async () => {
          if ((content === undefined) === (from_file === undefined)) {
            throw new Error("Provide exactly one of content or from_file.");
          }
          const text = content ?? (await fileText(from_file!));
          if (text.length > MAX_DOCUMENT_LENGTH) {
            throw new Error(
              `Documents are limited to ${MAX_DOCUMENT_LENGTH} characters.`,
            );
          }
          const document: DocumentOutput = {
            id: uniqueId(title),
            title,
            type,
            ...(type === "code" && language ? { language } : {}),
            version: 1,
            content: text,
          };
          latest.set(document.id, document);
          return document;
        }),
      toModelOutput: ({ output }) =>
        isDocumentOutput(output)
          ? {
              type: "text",
              value: `Created document ${JSON.stringify(output.id)} (${JSON.stringify(output.title)}, version 1). It is shown beside the chat; use this id to update it.`,
            }
          : { type: "error-text", value: "This document is unavailable." },
    }),

    [UPDATE_DOCUMENT_TOOL_NAME]: tool<
      { id: string; title?: string; edits?: DocumentEdit[]; content?: string },
      DocumentOutput,
      Record<string, never>
    >({
      description:
        "Revise an existing document, creating its next version. Use edits to replace exact passages of the latest version, or content to replace the whole document. Optionally rename it with title.",
      inputSchema: z.object({
        id: z.string().trim().min(1).describe("The document's id"),
        title: titleSchema.optional().describe("A new title"),
        edits: z
          .array(
            z.object({
              find: z
                .string()
                .min(1)
                .describe(
                  "Exact text from the latest version; it must occur exactly once",
                ),
              replace: z.string().describe("Replacement text"),
            }),
          )
          .min(1)
          .max(MAX_EDITS)
          .optional()
          .describe("Replacements applied in order"),
        content: z
          .string()
          .max(MAX_DOCUMENT_LENGTH)
          .optional()
          .describe("The complete new document, replacing the old one"),
      }),
      execute: ({ id, title, edits, content }) =>
        serialized(() => {
          if (edits !== undefined && content !== undefined) {
            throw new Error("Provide edits or content, not both.");
          }
          if (edits === undefined && content === undefined && title === undefined) {
            throw new Error("Provide edits, content, or a new title.");
          }
          const current = resolve(id);
          let next = content ?? current.content;
          for (const [index, edit] of (edits ?? []).entries()) {
            next = applyEdit(next, edit, index, current);
          }
          if (next.length > MAX_DOCUMENT_LENGTH) {
            throw new Error(
              `Documents are limited to ${MAX_DOCUMENT_LENGTH} characters.`,
            );
          }
          const document: DocumentOutput = {
            ...current,
            ...(title ? { title } : {}),
            version: current.version + 1,
            content: next,
          };
          latest.set(document.id, document);
          return document;
        }),
      toModelOutput: ({ output }) =>
        isDocumentOutput(output)
          ? {
              type: "text",
              value: `Updated document ${JSON.stringify(output.id)} to version ${output.version}.`,
            }
          : { type: "error-text", value: "This document is unavailable." },
    }),
  });
}

export type DocumentTools = ReturnType<typeof createDocumentTools>;

function applyEdit(
  content: string,
  edit: DocumentEdit,
  index: number,
  document: DocumentOutput,
): string {
  const first = content.indexOf(edit.find);
  const label = `Edit ${index + 1}`;
  if (first < 0) {
    throw new Error(
      `${label}: the find text does not occur in ${JSON.stringify(document.id)}. No edits were applied. Copy the text exactly from the latest version:\n${excerpt(content)}`,
    );
  }
  const second = content.indexOf(edit.find, first + 1);
  if (second >= 0) {
    let count = 2;
    for (
      let position = content.indexOf(edit.find, second + 1);
      position >= 0;
      position = content.indexOf(edit.find, position + 1)
    ) {
      count++;
    }
    throw new Error(
      `${label}: the find text occurs ${count} times in ${JSON.stringify(document.id)}. No edits were applied. Include surrounding text so it matches exactly once.`,
    );
  }
  return (
    content.slice(0, first) + edit.replace + content.slice(first + edit.find.length)
  );
}

function excerpt(content: string): string {
  return content.length > MAX_ERROR_CONTENT
    ? `${content.slice(0, MAX_ERROR_CONTENT)}\n[…${content.length - MAX_ERROR_CONTENT} more characters]`
    : content;
}
