import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { extractedText: string | null; truncated: boolean; userId: string };

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/uploads", () => ({
  getUpload: vi.fn(async (id: string, userId: string) => {
    const row = mocks.rows.get(id);
    return row && row.userId === userId ? row : null;
  }),
}));

import type { ReadFileOutput, SearchFilesOutput } from "@overtchat/shared";
import { countTextTokens } from "./context-budget";
import type { ChatFile } from "./chat-files";
import { createFileTools, FILE_TOOL_ORDER } from "./file-tools";
import { getUpload } from "@/lib/db/uploads";

const options = {
  toolCallId: "call",
  messages: [],
  abortSignal: undefined,
  context: {},
};

const files: ChatFile[] = [
  { uploadId: "report", name: "Q3 report.pdf", mediaType: "application/pdf" },
  { uploadId: "notes", name: "notes.md", mediaType: "text/markdown" },
  { uploadId: "photo", name: "photo.png", mediaType: "image/png" },
  { uploadId: "gone", name: "deleted.txt", mediaType: "text/plain" },
];

const reportLine = "Section text about operations, staffing and logistics.\n";
const report = `${reportLine.repeat(600)}Net revenue reached 4.2 million in the third quarter.\n${reportLine.repeat(600)}`;

/** File tools return plain results, never streamed iterables. */
function settled<T>(value: T | AsyncIterable<T>): T {
  return value as T;
}

function tools(chunkTokens = 1_000, userId = "user") {
  return createFileTools({ userId, files, chunkTokens });
}

async function read(input: { file: string; offset?: number }, chunkTokens?: number) {
  const fileTools = tools(chunkTokens);
  const output: ReadFileOutput = settled(await fileTools.read_file.execute!(input, options));
  const model = await fileTools.read_file.toModelOutput!({
    toolCallId: "call",
    input,
    output,
  });
  return { output, model };
}

describe("file tools", () => {
  beforeAll(() => {
    // Building the real tokenizer's vocabulary can exceed a test's 5s budget
    // on a busy runner. Pay that one-time cost in setup instead.
    countTextTokens("Initialize the chat tokenizer.");
  }, 30_000);

  beforeEach(() => {
    mocks.rows.clear();
    mocks.rows.set("report", { extractedText: report, truncated: false, userId: "user" });
    mocks.rows.set("notes", {
      extractedText: "# Notes\nRevenue targets for Q4 are ambitious.\nCosts flat.",
      truncated: false,
      userId: "user",
    });
  });

  it("exposes read then search in a stable order", () => {
    expect(Object.keys(tools())).toEqual([...FILE_TOOL_ORDER]);
  });

  it("reads a document chunk by chunk without gaps", async () => {
    let offset: number | undefined = 0;
    const parts: string[] = [];
    let calls = 0;
    while (offset !== undefined) {
      const { output, model } = await read({ file: "q3 REPORT.pdf", offset });
      expect(output).toMatchObject({
        file: "Q3 report.pdf",
        uploadId: "report",
        offset,
        totalCharacters: report.length,
      });
      expect(model.type).toBe("text");
      const value = (model as { value: string }).value;
      const content = /<content>\n([\s\S]*)\n<\/content>/.exec(value)![1];
      expect(content).toBe(report.slice(output.offset, output.end));
      expect(countTextTokens(content)).toBeLessThanOrEqual(1_010);
      if (output.nextOffset !== undefined) {
        expect(output.nextOffset).toBe(output.end);
        expect(value).toContain(`Continue with read_file offset ${output.end}.`);
      } else {
        expect(value.endsWith("End of file.")).toBe(true);
      }
      parts.push(content);
      offset = output.nextOffset;
      calls++;
    }
    expect(parts.join("")).toBe(report);
    expect(calls).toBeGreaterThan(5);
  });

  it("does not store document text in the tool result", async () => {
    const { output } = await read({ file: "notes.md" });
    expect(JSON.stringify(output)).not.toContain("Revenue targets");
    expect(output).toEqual({
      file: "notes.md",
      uploadId: "notes",
      offset: 0,
      end: 57,
      totalCharacters: 57,
    });
  });

  it("explains offsets past the end, unknown files and images", async () => {
    await expect(read({ file: "notes.md", offset: 58 })).rejects.toThrow(
      'Offset 58 is past the end of "notes.md", which has 57 characters.',
    );
    await expect(read({ file: "missing.pdf" })).rejects.toThrow(
      'No file named "missing.pdf" is attached to this conversation. Attached documents: "Q3 report.pdf", "notes.md", "deleted.txt".',
    );
    await expect(read({ file: "photo.png" })).rejects.toThrow(
      '"photo.png" is an image. Images are included in the conversation as images, not as text.',
    );
    await expect(read({ file: "deleted.txt" })).rejects.toThrow(
      '"deleted.txt" is no longer available.',
    );
  });

  it("says when a file has no readable text", async () => {
    mocks.rows.set("archive", { extractedText: null, truncated: false, userId: "user" });
    const archive = createFileTools({
      userId: "user",
      files: [{ uploadId: "archive", name: "results.zip", mediaType: "application/zip" }],
      chunkTokens: 1_000,
    });
    await expect(
      archive.read_file.execute!({ file: "results.zip" }, options),
    ).rejects.toThrow('"results.zip" has no readable text.');
  });

  it("reads the end exactly at the document length", async () => {
    const { output, model } = await read({ file: "notes.md", offset: 57 });
    expect(output).toMatchObject({ offset: 57, end: 57 });
    expect((model as { value: string }).value).toContain("<content>\n\n</content>\nEnd of file.");
  });

  it("notes text cut at the extraction limit", async () => {
    mocks.rows.set("notes", { extractedText: "partial text", truncated: true, userId: "user" });
    const { output, model } = await read({ file: "notes.md" });
    expect(output.incomplete).toBe(true);
    expect((model as { value: string }).value).toContain(
      "End of the stored text. The original file was longer than the extraction limit, so the rest is unavailable.",
    );
  });

  it("rehydrates stored reads only for the owner", async () => {
    const stored = {
      file: "notes.md",
      uploadId: "notes",
      offset: 8,
      end: 46,
      totalCharacters: 57,
      nextOffset: 46,
    };
    await expect(
      tools().read_file.toModelOutput!({ toolCallId: "c", input: { file: "notes.md" }, output: stored }),
    ).resolves.toEqual({
      type: "text",
      value:
        "notes.md: characters 8 to 46 of 57.\n<content>\nRevenue targets for Q4 are ambitious.\n\n</content>\nMore text follows. Continue with read_file offset 46.",
    });
    await expect(
      tools(1_000, "intruder").read_file.toModelOutput!({ toolCallId: "c", input: { file: "notes.md" }, output: stored }),
    ).resolves.toEqual({ type: "error-text", value: '"notes.md" is no longer available.' });
    await expect(
      tools().read_file.toModelOutput!({
        toolCallId: "c",
        input: { file: "notes.md" },
        output: { file: "notes.md", uploadId: "notes", offset: 9, end: 2 } as never,
      }),
    ).resolves.toEqual({ type: "error-text", value: "This file read is unavailable." });
  });

  it("finds an exact phrase and points read_file at it", async () => {
    const fileTools = tools();
    const output: SearchFilesOutput = settled(
      await fileTools.search_files.execute!({ query: "net revenue" }, options),
    );
    expect(output.files).toEqual(["Q3 report.pdf", "notes.md", "deleted.txt"]);
    expect(output.totalMatches).toBe(1);
    expect(output.matches[0]).toMatchObject({
      file: "Q3 report.pdf",
      snippet: expect.stringContaining("Net revenue reached 4.2 million"),
    });
    expect(report.slice(output.matches[0].offset)).toContain("Net revenue reached");
    const model = await fileTools.search_files.toModelOutput!({
      toolCallId: "c",
      input: { query: "net revenue" },
      output,
    });
    expect((model as { value: string }).value).toMatch(
      /^1 match for "net revenue" in "Q3 report\.pdf", "notes\.md", "deleted\.txt":\n1\. "Q3 report\.pdf" at offset \d+: .*Net revenue reached 4\.2 million.*\nRead a match in context with read_file using its file and offset\.$/,
    );
  });

  it("falls back to nearby query words and limits results", async () => {
    mocks.rows.set("notes", {
      extractedText: Array.from({ length: 30 }, (_, i) => `Item ${i}: revenue up, costs down.${" filler".repeat(80)}`).join("\n"),
      truncated: false,
      userId: "user",
    });
    const output: SearchFilesOutput = settled(
      await tools().search_files.execute!(
        { query: "costs revenue forecast", file: "notes.md" },
        options,
      ),
    );
    expect(output.files).toEqual(["notes.md"]);
    expect(output.matches).toHaveLength(10);
    expect(output.totalMatches).toBe(30);
    const model = await tools().search_files.toModelOutput!({
      toolCallId: "c",
      input: { query: "x" },
      output,
    });
    expect((model as { value: string }).value).toMatch(/^Showing 10 of 30 matches/);
  });

  it("reports no matches and rejects searching an image", async () => {
    const output: SearchFilesOutput = settled(
      await tools().search_files.execute!({ query: "zebra crossing" }, options),
    );
    expect(output).toMatchObject({ matches: [], totalMatches: 0 });
    const model = await tools().search_files.toModelOutput!({
      toolCallId: "c",
      input: { query: "zebra crossing" },
      output,
    });
    expect((model as { value: string }).value).toBe(
      'No matches for "zebra crossing" in "Q3 report.pdf", "notes.md", "deleted.txt". Try other words, or read the file with read_file.',
    );
    await expect(
      tools().search_files.execute!({ query: "x", file: "photo.png" }, options),
    ).rejects.toThrow("is an image");
    await expect(
      tools().search_files.execute!({ query: "x", file: "deleted.txt" }, options),
    ).rejects.toThrow("no longer available");
  });

  it("fails clearly when a conversation has no documents", async () => {
    const imageOnly = createFileTools({
      userId: "user",
      files: [files[2]],
      chunkTokens: 1_000,
    });
    await expect(
      imageOnly.search_files.execute!({ query: "x" }, options),
    ).rejects.toThrow("No documents are attached to this conversation.");
    await expect(
      imageOnly.read_file.execute!({ file: "a.pdf" }, options),
    ).rejects.toThrow("No documents are attached to this conversation.");
  });

  it("loads each upload once while replaying many reads", async () => {
    vi.mocked(getUpload).mockClear();
    const fileTools = tools();
    const stored = (offset: number) => ({
      file: "Q3 report.pdf",
      uploadId: "report",
      offset,
      end: offset + 10,
      totalCharacters: report.length,
      nextOffset: offset + 10,
    });
    const outputs = await Promise.all(
      [0, 10, 20, 30].map((offset) =>
        fileTools.read_file.toModelOutput!({
          toolCallId: `c${offset}`,
          input: { file: "Q3 report.pdf" },
          output: stored(offset),
        }),
      ),
    );
    expect(outputs.every((output) => output.type === "text")).toBe(true);
    expect(getUpload).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed stored search results", async () => {
    expect(
      await tools().search_files.toModelOutput!({
        toolCallId: "c",
        input: { query: "x" },
        output: { query: "x", matches: "nope" } as never,
      }),
    ).toEqual({ type: "error-text", value: "This file search is unavailable." });
  });
});
