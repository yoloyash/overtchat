import type { UIMessage } from "ai";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  userId: string;
  filename: string;
  mediaType: string;
  category: "image" | "document" | "text" | "spreadsheet";
  extractedText: string | null;
  truncated: boolean;
};

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  readFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ default: { mkdirSync: vi.fn() } }));
vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile, writeFile: vi.fn(), rm: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ and: conditions }),
  eq: (column: string, value: string) => ({ [column]: value }),
  lt: vi.fn(),
  sql: vi.fn(),
}));
vi.mock("@/lib/db/schema", () => ({
  messages: {},
  chatShareUploads: {},
  uploads: { id: "id", userId: "userId" },
}));
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: { and: Array<Record<string, string>> }) => ({
          limit: async () => {
            const [{ id }, { userId }] = condition.and;
            const row = mocks.rows.get(id);
            return row && row.userId === userId ? [row] : [];
          },
        }),
      }),
    }),
  },
}));

import { countTextTokens } from "@/lib/chat/context-budget";
import { inlineUploads } from "./uploads";

function addRow(row: Partial<Row> & Pick<Row, "id">) {
  mocks.rows.set(row.id, {
    userId: "user",
    filename: `${row.id}.txt`,
    mediaType: "text/plain",
    category: "text",
    extractedText: "",
    truncated: false,
    ...row,
  });
}

function message(parts: UIMessage["parts"], id = "m1"): UIMessage {
  return { id, role: "user", parts };
}

function attachment(id: string, filename = `${id}.txt`) {
  return {
    type: "file" as const,
    url: `/api/uploads/${id}`,
    mediaType: "text/plain",
    filename,
  };
}

function textOf(result: UIMessage[]): string {
  return result[0].parts
    .filter((part) => part.type === "text")
    .map((part) => (part as { text: string }).text)
    .join("\n");
}

const line = "Line of a long report about quarterly revenue and costs.\n";

describe("attachment inlining", () => {
  beforeAll(() => {
    // Building the real tokenizer's vocabulary can exceed a test's 5s budget
    // on a busy runner. Pay that one-time cost in setup instead.
    countTextTokens("Initialize the chat tokenizer.");
  }, 30_000);

  beforeEach(() => {
    mocks.rows.clear();
    mocks.readFile.mockReset();
  });

  it("keeps the previous format for documents that fit", async () => {
    addRow({ id: "a", filename: "notes.md", extractedText: "# Notes\nhello" });
    const options = { tokenBudget: 1_000, readerAvailable: true, onPartial: vi.fn() };
    const [budgeted, unbudgeted] = await Promise.all([
      inlineUploads([message([attachment("a", "notes.md"), { type: "text", text: "Summarize" }])], "user", options),
      inlineUploads([message([attachment("a", "notes.md"), { type: "text", text: "Summarize" }])], "user"),
    ]);
    const expected =
      '<documents>\n<document index="1">\n<source>notes.md</source>\n<document_content>\n# Notes\nhello\n</document_content>\n</document>\n</documents>\n\nSummarize';
    expect(textOf(budgeted)).toBe(expected);
    expect(textOf(unbudgeted)).toBe(expected);
    expect(options.onPartial).not.toHaveBeenCalled();
  });

  it("includes a budgeted prefix and says where reading resumes", async () => {
    const text = line.repeat(2_000);
    addRow({ id: "big", filename: "report.txt", extractedText: text });
    const onPartial = vi.fn();
    const result = await inlineUploads(
      [message([{ type: "text", text: "What changed?" }, attachment("big", "report.txt")])],
      "user",
      {
        tokenBudget: 1_000,
        fileNames: new Map([["big", "report (2).txt"]]),
        readerAvailable: true,
        onPartial,
      },
    );
    const rendered = textOf(result);
    const content = /<document_content>\n([\s\S]*)\n<\/document_content>/.exec(rendered)![1];
    expect(text.startsWith(content)).toBe(true);
    expect(content.endsWith("\n")).toBe(true);
    expect(countTextTokens(content)).toBeLessThanOrEqual(1_010);
    expect(rendered).toContain("<source>report (2).txt</source>");
    expect(rendered).toContain(
      `<document_status>Included the first ${content.length} of ${text.length} characters. Use read_file with file "report (2).txt" and offset ${content.length} to read further, or search_files to find specific passages.</document_status>`,
    );
    expect(rendered.endsWith("</documents>\n\nWhat changed?")).toBe(true);
    expect(onPartial).toHaveBeenCalledWith("big");
  });

  it("is deterministic across turns", async () => {
    addRow({ id: "big", extractedText: line.repeat(3_000) });
    const run = () =>
      inlineUploads([message([attachment("big")])], "user", {
        tokenBudget: 2_000,
        readerAvailable: true,
      });
    expect(textOf(await run())).toBe(textOf(await run()));
  });

  it("says the rest is unavailable when the model cannot call tools", async () => {
    addRow({ id: "big", extractedText: line.repeat(2_000) });
    const rendered = textOf(
      await inlineUploads([message([attachment("big")])], "user", {
        tokenBudget: 500,
        readerAvailable: false,
      }),
    );
    expect(rendered).toMatch(
      /<document_status>Included the first \d+ of \d+ characters\. The rest of this document is not available in this conversation\.<\/document_status>/,
    );
    expect(rendered).not.toContain("read_file");
  });

  it("splits a message budget across documents and keeps small ones whole", async () => {
    addRow({ id: "small", extractedText: "short note" });
    addRow({ id: "one", extractedText: line.repeat(1_000) });
    addRow({ id: "two", extractedText: line.repeat(1_000) });
    const partial: string[] = [];
    const rendered = textOf(
      await inlineUploads(
        [message([attachment("small"), attachment("one"), attachment("two")])],
        "user",
        { tokenBudget: 3_000, readerAvailable: true, onPartial: (id) => partial.push(id) },
      ),
    );
    const contents = [...rendered.matchAll(/<document_content>\n([\s\S]*?)\n<\/document_content>/g)].map(
      (match) => match[1],
    );
    expect(contents[0]).toBe("short note");
    const [one, two] = [contents[1], contents[2]].map((content) => countTextTokens(content));
    expect(one).toBeGreaterThan(1_300);
    expect(one).toBeLessThanOrEqual(1_500);
    expect(Math.abs(one - two)).toBeLessThan(20);
    expect(partial).toEqual(["one", "two"]);
  });

  it("budgets each message separately and inlines images as data", async () => {
    addRow({ id: "doc1", extractedText: line.repeat(500) });
    addRow({ id: "doc2", extractedText: line.repeat(500) });
    addRow({ id: "img", category: "image", mediaType: "image/png", filename: "a.png", extractedText: null });
    mocks.readFile.mockResolvedValue(Buffer.from("png-bytes"));
    const partial: string[] = [];
    const result = await inlineUploads(
      [
        message([attachment("doc1")], "m1"),
        message([
          { type: "file", url: "/api/uploads/img", mediaType: "image/png", filename: "a.png" },
          attachment("doc2"),
        ], "m2"),
      ],
      "user",
      { tokenBudget: 800, readerAvailable: true, onPartial: (id) => partial.push(id) },
    );
    expect(partial.sort()).toEqual(["doc1", "doc2"]);
    expect(result[1].parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("<source>doc2.txt</source>"),
    });
    expect(result[1].parts[1]).toMatchObject({
      type: "file",
      url: `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`,
    });
  });

  it("drops uploads owned by another user", async () => {
    addRow({ id: "foreign", userId: "other", extractedText: "secret" });
    const result = await inlineUploads(
      [message([attachment("foreign"), { type: "text", text: "hi" }])],
      "user",
      { tokenBudget: 1_000 },
    );
    expect(result[0].parts).toEqual([{ type: "text", text: "hi" }]);
  });

  it("lists a message's files at their sandbox paths before the question when code can run", async () => {
    addRow({ id: "doc", filename: "notes.txt", extractedText: "short note" });
    addRow({ id: "img", category: "image", mediaType: "image/png", filename: "a.png", extractedText: null });
    mocks.readFile.mockResolvedValue(Buffer.from("png-bytes"));
    const parts: UIMessage["parts"] = [
      attachment("doc", "notes.txt"),
      { type: "file", url: "/api/uploads/img", mediaType: "image/png", filename: "a.png" },
      { type: "text", text: "Blur the face" },
    ];
    const fileNames = new Map([["doc", "notes (2).txt"]]);
    const [withCode] = await inlineUploads([message(parts)], "user", {
      tokenBudget: 1_000,
      fileNames,
      codeExecution: true,
    });
    expect(withCode.parts.map((part) => part.type)).toEqual(["text", "file", "text"]);
    const first = (withCode.parts[0] as { text: string }).text;
    expect(first.endsWith(
      "</documents>\n\nFiles from this message are available to run_python at: /mnt/data/uploads/notes (2).txt, /mnt/data/uploads/a.png",
    )).toBe(true);
    expect(withCode.parts[2]).toEqual({ type: "text", text: "Blur the face" });

    const [withoutCode] = await inlineUploads([message(parts)], "user", { tokenBudget: 1_000, fileNames });
    expect(textOf([withoutCode])).not.toContain("run_python");
  });

  it("includes only a preview of spreadsheets when code can run", async () => {
    const csv = `region,month,total\n${"north,2026-01,1234.5\n".repeat(5_000)}`;
    addRow({ id: "sheet", filename: "sales.csv", category: "spreadsheet", mediaType: "text/csv", extractedText: csv });
    const onPartial = vi.fn();
    const rendered = textOf(
      await inlineUploads([message([attachment("sheet", "sales.csv")])], "user", {
        tokenBudget: 50_000,
        readerAvailable: true,
        codeExecution: true,
        onPartial,
      }),
    );
    const content = /<document_content>\n([\s\S]*)\n<\/document_content>/.exec(rendered)![1];
    expect(csv.startsWith(content)).toBe(true);
    expect(countTextTokens(content)).toBeLessThanOrEqual(2_010);
    expect(rendered).toContain(
      `<document_status>Included the first ${content.length} of ${csv.length} characters. Analyze the whole file with run_python at /mnt/data/uploads/sales.csv.</document_status>`,
    );
    expect(onPartial).toHaveBeenCalledWith("sheet");

    // Without code execution the same budget includes the whole spreadsheet.
    const whole = textOf(
      await inlineUploads([message([attachment("sheet", "sales.csv")])], "user", {
        tokenBudget: 1_000_000,
        readerAvailable: true,
      }),
    );
    expect(whole).not.toContain("<document_status>");
  });

  it("keeps the truncated marker for text cut at extraction", async () => {
    addRow({
      id: "cut",
      filename: "huge.txt",
      extractedText: "start\n\n[truncated: 10 more characters omitted]",
      truncated: true,
    });
    const rendered = textOf(
      await inlineUploads([message([attachment("cut", "huge.txt")])], "user", {
        tokenBudget: 1_000,
      }),
    );
    expect(rendered).toContain("<source>huge.txt (truncated)</source>");
    expect(rendered).not.toContain("<document_status>");
  });
});
