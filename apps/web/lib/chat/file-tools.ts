import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  READ_FILE_TOOL_NAME,
  SEARCH_FILES_TOOL_NAME,
  type ReadFileOutput,
  type SearchFilesMatch,
  type SearchFilesOutput,
} from "@overtchat/shared";
import { getUpload } from "@/lib/db/uploads";
import {
  findChatFile,
  isDocumentFile,
  type ChatFile,
} from "@/lib/chat/chat-files";
import {
  findPhrase,
  findTerms,
  normalizeOffset,
  rangeEnd,
  snippetAround,
  type TextMatch,
} from "@/lib/chat/document-text";

/** Exhaustive file-tool names in deterministic provider order. */
export const FILE_TOOL_ORDER = Object.freeze([
  READ_FILE_TOOL_NAME,
  SEARCH_FILES_TOOL_NAME,
] as const);

const MAX_SEARCH_RESULTS = 10;

/**
 * Tools that read the extracted text of documents attached to this
 * conversation. Only uploads referenced by the conversation and owned by the
 * user are reachable; results store character ranges, not text.
 */
export function createFileTools({
  userId,
  files,
  chunkTokens,
}: {
  userId: string;
  files: readonly ChatFile[];
  chunkTokens: number;
}) {
  // Replaying a long conversation can rehydrate many reads of one large
  // document; load each upload once per request.
  const loaded = new Map<string, ReturnType<typeof getUpload>>();
  function load(uploadId: string): ReturnType<typeof getUpload> {
    let row = loaded.get(uploadId);
    if (!row) {
      row = getUpload(uploadId, userId);
      loaded.set(uploadId, row);
    }
    return row;
  }

  function resolveDocument(reference: string): ChatFile {
    const file = findChatFile(files, reference);
    if (!file) {
      const names = files.filter(isDocumentFile).map((entry) => entry.name);
      throw new Error(
        names.length
          ? `No file named ${JSON.stringify(reference)} is attached to this conversation. Attached documents: ${names.map((name) => JSON.stringify(name)).join(", ")}.`
          : "No documents are attached to this conversation.",
      );
    }
    if (!isDocumentFile(file)) {
      throw new Error(
        `${JSON.stringify(file.name)} is an image. Images are included in the conversation as images, not as text.`,
      );
    }
    return file;
  }

  async function documentText(
    file: ChatFile,
  ): Promise<{ text: string; incomplete: boolean }> {
    const row = await load(file.uploadId);
    if (!row || row.extractedText === null) {
      throw new Error(`${JSON.stringify(file.name)} is no longer available.`);
    }
    return { text: row.extractedText, incomplete: row.truncated };
  }

  return Object.freeze({
    [READ_FILE_TOOL_NAME]: tool<
      { file: string; offset?: number },
      ReadFileOutput,
      Record<string, never>
    >({
      description:
        "Read the text of a document attached to this conversation, starting at a character offset. Use it when a document was only partly included in the conversation, or to reread part of an earlier attachment. Each call returns one chunk; when more text follows, the result gives the next offset.",
      inputSchema: z.object({
        file: z
          .string()
          .min(1)
          .describe("The attached file's name, as shown in the conversation"),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            "Character offset to start reading from, as given by the conversation, a previous read_file result, or a search_files match. Defaults to 0.",
          ),
      }),
      execute: async ({ file: reference, offset = 0 }) => {
        const file = resolveDocument(reference);
        const { text, incomplete } = await documentText(file);
        if (offset > text.length) {
          throw new Error(
            `Offset ${offset} is past the end of ${JSON.stringify(file.name)}, which has ${text.length} characters.`,
          );
        }
        const start = normalizeOffset(text, offset);
        let end = rangeEnd(
          text,
          start,
          chunkTokens,
          start === 0 ? file.uploadId : undefined,
        );
        if (end <= start && start < text.length) {
          end = normalizeOffset(text, start + 1_000);
        }
        return {
          file: file.name,
          uploadId: file.uploadId,
          offset: start,
          end,
          totalCharacters: text.length,
          ...(end < text.length ? { nextOffset: end } : {}),
          ...(incomplete ? { incomplete: true } : {}),
        };
      },
      toModelOutput: async ({ output }) => {
        if (!isReadFileOutput(output)) {
          return { type: "error-text", value: "This file read is unavailable." };
        }
        const row = await load(output.uploadId);
        if (!row || row.extractedText === null) {
          return {
            type: "error-text",
            value: `${JSON.stringify(output.file)} is no longer available.`,
          };
        }
        return {
          type: "text",
          value: formatRead(
            output,
            row.extractedText.slice(output.offset, output.end),
          ),
        };
      },
    }),

    [SEARCH_FILES_TOOL_NAME]: tool<
      { query: string; file?: string },
      SearchFilesOutput,
      Record<string, never>
    >({
      description:
        "Search the text of documents attached to this conversation. Matches the whole query first, then passages containing most of its words. Returns short excerpts with offsets to pass to read_file.",
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("Words or a phrase to find"),
        file: z
          .string()
          .min(1)
          .optional()
          .describe("Search only this file. Omit to search every attached document."),
      }),
      execute: async ({ query, file: reference }) => {
        const targets = reference
          ? [resolveDocument(reference)]
          : files.filter(isDocumentFile);
        if (!targets.length) {
          throw new Error("No documents are attached to this conversation.");
        }
        const documents: Array<{ file: ChatFile; text: string }> = [];
        for (const file of targets) {
          try {
            documents.push({ file, text: (await documentText(file)).text });
          } catch (error) {
            // A single unavailable file must not hide matches in the others.
            if (reference) throw error;
          }
        }
        let found: Array<{ file: ChatFile; text: string; match: TextMatch }> =
          documents.flatMap(({ file, text }) =>
            findPhrase(text, query).map((match) => ({ file, text, match })),
          );
        if (!found.length) {
          found = documents
            .flatMap(({ file, text }) =>
              findTerms(text, query).map((match) => ({ file, text, match })),
            )
            .sort((a, b) => b.match.score - a.match.score);
        }
        return {
          query,
          files: targets.map((file) => file.name),
          matches: found
            .slice(0, MAX_SEARCH_RESULTS)
            .map(({ file, text, match }): SearchFilesMatch => ({
              file: file.name,
              ...snippetAround(text, match),
            })),
          totalMatches: found.length,
        };
      },
      toModelOutput: ({ output }) =>
        isSearchFilesOutput(output)
          ? { type: "text", value: formatSearch(output) }
          : { type: "error-text", value: "This file search is unavailable." },
    }),
  });
}

export type FileTools = ReturnType<typeof createFileTools>;

function formatRead(output: ReadFileOutput, content: string): string {
  const ending =
    output.nextOffset !== undefined
      ? `More text follows. Continue with read_file offset ${output.nextOffset}.`
      : output.incomplete
        ? "End of the stored text. The original file was longer than the extraction limit, so the rest is unavailable."
        : "End of file.";
  return `${output.file}: characters ${output.offset} to ${output.end} of ${output.totalCharacters}.\n<content>\n${content}\n</content>\n${ending}`;
}

function formatSearch(output: SearchFilesOutput): string {
  const scope = output.files.map((name) => JSON.stringify(name)).join(", ");
  if (!output.matches.length) {
    return `No matches for ${JSON.stringify(output.query)} in ${scope}. Try other words, or read the file with read_file.`;
  }
  const shown =
    output.totalMatches > output.matches.length
      ? `Showing ${output.matches.length} of ${output.totalMatches} matches`
      : `${output.matches.length} ${output.matches.length === 1 ? "match" : "matches"}`;
  const lines = output.matches.map(
    (match, index) =>
      `${index + 1}. ${JSON.stringify(match.file)} at offset ${match.offset}: ${match.snippet}`,
  );
  return `${shown} for ${JSON.stringify(output.query)} in ${scope}:\n${lines.join("\n")}\nRead a match in context with read_file using its file and offset.`;
}

function isSearchFilesOutput(value: unknown): value is SearchFilesOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<SearchFilesOutput>;
  return (
    typeof output.query === "string" &&
    Array.isArray(output.files) &&
    output.files.every((file) => typeof file === "string") &&
    Array.isArray(output.matches) &&
    output.matches.every(
      (match) =>
        typeof match?.file === "string" &&
        typeof match.offset === "number" &&
        typeof match.snippet === "string",
    ) &&
    typeof output.totalMatches === "number"
  );
}

function isReadFileOutput(value: unknown): value is ReadFileOutput {
  if (!value || typeof value !== "object") return false;
  const output = value as Partial<ReadFileOutput>;
  return (
    typeof output.file === "string" &&
    typeof output.uploadId === "string" &&
    Number.isInteger(output.offset) &&
    Number.isInteger(output.end) &&
    output.offset! >= 0 &&
    output.end! >= output.offset! &&
    typeof output.totalCharacters === "number"
  );
}
