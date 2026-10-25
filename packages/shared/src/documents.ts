import type { UIMessage } from "ai";
import type { ToolState } from "./tools";

export const CREATE_DOCUMENT_TOOL_NAME = "create_document" as const;
export const UPDATE_DOCUMENT_TOOL_NAME = "update_document" as const;

export const DOCUMENT_TYPES = [
  "markdown",
  "code",
  "html",
  "svg",
  "mermaid",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  markdown: "Document",
  code: "Code",
  html: "Web page",
  svg: "SVG image",
  mermaid: "Diagram",
};

/** Larger than any single model reply, small enough to render and replay. */
export const MAX_DOCUMENT_LENGTH = 400_000;

export interface DocumentEdit {
  find: string;
  replace: string;
}

export interface CreateDocumentInput {
  title?: string;
  type?: DocumentType;
  language?: string;
  content?: string;
  from_file?: string;
}

export interface UpdateDocumentInput {
  id?: string;
  title?: string;
  edits?: DocumentEdit[];
  content?: string;
}

/** One saved version. Each version carries its full content, so clients and
 * shared snapshots render any version without replaying edits. */
export interface DocumentOutput {
  id: string;
  title: string;
  type: DocumentType;
  language?: string;
  version: number;
  content: string;
}

export type DocumentToolPart = {
  type: "tool-create_document" | "tool-update_document";
  toolCallId: string;
  state: ToolState;
  input?: CreateDocumentInput & UpdateDocumentInput;
  output?: DocumentOutput;
  errorText?: string;
};

export interface DocumentVersion extends DocumentOutput {
  messageId: string;
  toolCallId: string;
}

export function isDocumentToolPart(part: {
  type: string;
}): part is DocumentToolPart {
  return (
    part.type === "tool-create_document" || part.type === "tool-update_document"
  );
}

export function isDocumentOutput(value: unknown): value is DocumentOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<DocumentOutput>;
  return (
    typeof output.id === "string" &&
    output.id.length > 0 &&
    typeof output.title === "string" &&
    (DOCUMENT_TYPES as readonly unknown[]).includes(output.type) &&
    (output.language === undefined || typeof output.language === "string") &&
    Number.isInteger(output.version) &&
    output.version! >= 1 &&
    typeof output.content === "string"
  );
}

/** Saved versions of each document in conversation order, keyed by ID. */
export function collectDocumentVersions(
  messages: readonly UIMessage[],
): Map<string, DocumentVersion[]> {
  const documents = new Map<string, DocumentVersion[]>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        !isDocumentToolPart(part) ||
        part.state !== "output-available" ||
        !isDocumentOutput(part.output)
      ) {
        continue;
      }
      const versions = documents.get(part.output.id) ?? [];
      versions.push({
        ...part.output,
        messageId: message.id,
        toolCallId: part.toolCallId,
      });
      documents.set(part.output.id, versions);
    }
  }
  return documents;
}

export interface DocumentDraft {
  title: string;
  type: DocumentType;
  language?: string;
  content: string;
}

/** What the document panel shows for one document tool call. */
export interface DocumentView {
  /** Saved versions of the document, oldest first. */
  versions: DocumentVersion[];
  /** Index into `versions` of the version shown. */
  index: number;
  /** A first version still being written; shown instead of `versions`. */
  draft?: DocumentDraft;
  /** A revision is being written; `index` shows the latest saved version. */
  updating?: boolean;
}

export function findDocumentPart(
  messages: readonly UIMessage[],
  toolCallId: string,
): DocumentToolPart | undefined {
  for (const message of messages) {
    for (const part of message.parts) {
      if (isDocumentToolPart(part) && part.toolCallId === toolCallId) {
        return part;
      }
    }
  }
  return undefined;
}

/** The document a tool call created or revised, once known. */
export function documentIdOf(part: DocumentToolPart): string | undefined {
  if (part.state === "output-available" && isDocumentOutput(part.output)) {
    return part.output.id;
  }
  return part.type === "tool-update_document" &&
    typeof part.input?.id === "string" &&
    part.input.id.trim()
    ? part.input.id.trim()
    : undefined;
}

export function documentView(
  messages: readonly UIMessage[],
  toolCallId: string,
): DocumentView | null {
  const part = findDocumentPart(messages, toolCallId);
  if (!part) return null;
  const id = documentIdOf(part);
  const versions = id ? (collectDocumentVersions(messages).get(id) ?? []) : [];
  if (part.state === "output-available" && isDocumentOutput(part.output)) {
    return {
      versions,
      index: versions.findIndex((version) => version.toolCallId === toolCallId),
    };
  }
  if (part.state === "output-error") {
    return versions.length ? { versions, index: versions.length - 1 } : null;
  }
  if (part.type === "tool-create_document") {
    const input = part.input ?? {};
    const type = (DOCUMENT_TYPES as readonly unknown[]).includes(input.type)
      ? (input.type as DocumentType)
      : "markdown";
    return {
      versions: [],
      index: -1,
      draft: {
        title: input.title?.trim() || "Untitled document",
        type,
        ...(type === "code" && input.language ? { language: input.language } : {}),
        content: typeof input.content === "string" ? input.content : "",
      },
    };
  }
  return versions.length
    ? { versions, index: versions.length - 1, updating: true }
    : null;
}

/**
 * Document calls in a live reply that the panel should react to. A new
 * document opens (unless the panel is closed and `openWhenClosed` is false),
 * and a revision of the open document replaces it. Calls whose target is not
 * yet known stay unhandled until their input arrives.
 */
export function followLiveDocuments(
  message: UIMessage | undefined,
  handled: ReadonlySet<string>,
  openDocumentId: string | undefined,
  openWhenClosed: boolean,
): { handled: string[]; follow?: string } {
  const result: { handled: string[]; follow?: string } = { handled: [] };
  if (message?.role !== "assistant") return result;
  const panelOpen = openDocumentId !== undefined;
  for (const part of message.parts) {
    if (!isDocumentToolPart(part) || handled.has(part.toolCallId)) continue;
    if (part.state === "output-error") {
      result.handled.push(part.toolCallId);
      continue;
    }
    if (part.type === "tool-create_document") {
      result.handled.push(part.toolCallId);
      if (panelOpen || openWhenClosed) result.follow = part.toolCallId;
      continue;
    }
    const id = documentIdOf(part);
    if (!id) continue;
    result.handled.push(part.toolCallId);
    if (panelOpen ? openDocumentId === id : openWhenClosed) {
      result.follow = part.toolCallId;
    }
  }
  return result;
}

const CODE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  "c#": "cs",
  "c++": "cpp",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  dart: "dart",
  diff: "diff",
  elixir: "ex",
  go: "go",
  graphql: "graphql",
  haskell: "hs",
  html: "html",
  java: "java",
  javascript: "js",
  js: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  lua: "lua",
  markdown: "md",
  php: "php",
  powershell: "ps1",
  python: "py",
  py: "py",
  r: "r",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  scss: "scss",
  sh: "sh",
  shell: "sh",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "ts",
  tsx: "tsx",
  typescript: "ts",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "sh",
};

export function documentExtension(
  document: Pick<DocumentOutput, "type" | "language">,
): string {
  switch (document.type) {
    case "markdown":
      return "md";
    case "html":
      return "html";
    case "svg":
      return "svg";
    case "mermaid":
      return "mmd";
    case "code":
      return CODE_EXTENSIONS[document.language?.trim().toLowerCase() ?? ""] ?? "txt";
  }
}

export function documentMediaType(
  document: Pick<DocumentOutput, "type" | "language">,
): string {
  switch (document.type) {
    case "markdown":
      return "text/markdown";
    case "html":
      return "text/html";
    case "svg":
      return "image/svg+xml";
    default:
      return "text/plain";
  }
}

export const WORD_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Markdown documents can also be exported as Word files. */
export function canExportToWord(document: Pick<DocumentOutput, "type">): boolean {
  return document.type === "markdown";
}

/** A download name from the title, safe on common filesystems. */
export function documentFilename(
  document: Pick<DocumentOutput, "title" | "type" | "language">,
  extension = documentExtension(document),
): string {
  const base =
    document.title
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 80)
      .trim() || "document";
  return `${base}.${extension}`;
}
