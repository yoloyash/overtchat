import type { ToolState } from "./tools";

export const READ_FILE_TOOL_NAME = "read_file" as const;
export const SEARCH_FILES_TOOL_NAME = "search_files" as const;

/**
 * A read of an attachment's extracted text. The text itself is not stored in
 * the message: replay reads the same character range from the immutable upload.
 */
export interface ReadFileOutput {
  file: string;
  uploadId: string;
  offset: number;
  end: number;
  totalCharacters: number;
  /** Present when more text follows `end`. */
  nextOffset?: number;
  /** The stored text was cut at the extraction limit, so the file is longer. */
  incomplete?: boolean;
}

export interface SearchFilesMatch {
  file: string;
  /** Start of the snippet; read_file from here to read the match in context. */
  offset: number;
  snippet: string;
}

export interface SearchFilesOutput {
  query: string;
  files: string[];
  matches: SearchFilesMatch[];
  /** Matches found before the result limit was applied. */
  totalMatches: number;
}

export type ReadFilePart = {
  type: "tool-read_file";
  toolCallId: string;
  state: ToolState;
  input?: { file?: string; offset?: number };
  output?: ReadFileOutput;
  errorText?: string;
};

export type SearchFilesPart = {
  type: "tool-search_files";
  toolCallId: string;
  state: ToolState;
  input?: { query?: string; file?: string };
  output?: SearchFilesOutput;
  errorText?: string;
};

export function isReadFilePart(part: { type: string }): part is ReadFilePart {
  return part.type === "tool-read_file";
}

export function isSearchFilesPart(part: {
  type: string;
}): part is SearchFilesPart {
  return part.type === "tool-search_files";
}

/** 950, 41.2k, 220k, 1.3M: locale-independent so web and native agree. */
export function compactCount(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 1_000) return String(n);
  const scale = (divisor: number) => {
    const scaled = n / divisor;
    return Number(scaled.toFixed(scaled < 10 ? 1 : 0));
  };
  const thousands = scale(1_000);
  return thousands < 1_000 ? `${thousands}k` : `${scale(1_000_000)}M`;
}

/** Short description of the range a read_file call returned. */
export function readFileRangeLabel(output: ReadFileOutput): string {
  if (output.offset === 0 && output.end >= output.totalCharacters) {
    return "whole file";
  }
  return `${compactCount(output.offset)}–${compactCount(output.end)} of ${compactCount(output.totalCharacters)} chars`;
}
