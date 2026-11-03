import type { CodeExecutionFile } from "@overtchat/shared";

export type FilePreview =
  | { kind: "image" }
  | { kind: "pdf" }
  | { kind: "table"; delimiter: "," | "\t" }
  | { kind: "markdown" }
  | { kind: "html" }
  | { kind: "text"; language: string }
  | { kind: "audio" }
  | { kind: "video" };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);

const TEXT_LANGUAGES: Record<string, string> = {
  "text/plain": "text",
  "text/x-python": "python",
  "application/json": "json",
  "application/xml": "xml",
  "application/yaml": "yaml",
};

/** Text previews load files up to this size; larger files only download. */
export const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

/** Rows a table preview shows. */
export const MAX_TABLE_ROWS = 500;

/**
 * How the side panel shows a file, from the media type the server gave it,
 * or null when the file only downloads.
 */
export function filePreview(file: Pick<CodeExecutionFile, "mediaType">): FilePreview | null {
  const type = file.mediaType;
  if (IMAGE_TYPES.has(type)) return { kind: "image" };
  if (type === "application/pdf") return { kind: "pdf" };
  if (type === "text/csv") return { kind: "table", delimiter: "," };
  if (type === "text/tab-separated-values") return { kind: "table", delimiter: "\t" };
  if (type === "text/markdown") return { kind: "markdown" };
  if (type === "text/html") return { kind: "html" };
  if (type in TEXT_LANGUAGES) return { kind: "text", language: TEXT_LANGUAGES[type] };
  if (type.startsWith("audio/")) return { kind: "audio" };
  if (type.startsWith("video/")) return { kind: "video" };
  return null;
}

/**
 * Rows of a CSV or TSV file. Quoted fields may contain the delimiter, line
 * breaks and doubled quotes.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') field += source[++i];
      else quoted = false;
    } else if (char === '"' && !field) {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
