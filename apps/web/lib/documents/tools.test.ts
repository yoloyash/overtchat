import type { UIMessage } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentOutput } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({
  uploads: new Map<string, { extractedText: string | null; truncated: boolean }>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/uploads", () => ({
  getUpload: vi.fn(async (id: string, userId: string) =>
    userId === "user" ? (mocks.uploads.get(id) ?? null) : null,
  ),
}));

import { createDocumentTools, DOCUMENT_TOOL_ORDER, DOCUMENT_TOOL_PROMPT } from "./tools";

const options = { toolCallId: "call", messages: [], abortSignal: undefined, context: {} };

function settled<T>(value: T | AsyncIterable<T>): T {
  return value as T;
}

function tools(messages: UIMessage[] = []) {
  return createDocumentTools({ userId: "user", messages });
}

async function create(
  documentTools: ReturnType<typeof tools>,
  input: Parameters<NonNullable<ReturnType<typeof tools>["create_document"]["execute"]>>[0],
): Promise<DocumentOutput> {
  return settled(await documentTools.create_document.execute!(input, options));
}

async function update(
  documentTools: ReturnType<typeof tools>,
  input: Parameters<NonNullable<ReturnType<typeof tools>["update_document"]["execute"]>>[0],
): Promise<DocumentOutput> {
  return settled(await documentTools.update_document.execute!(input, options));
}

function savedVersion(
  output: DocumentOutput,
  toolCallId: string,
  type: "create" | "update" = "create",
): UIMessage {
  return {
    id: `message-${toolCallId}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${type}_document`,
        toolCallId,
        state: "output-available",
        input: {},
        output,
      } as UIMessage["parts"][number],
    ],
  };
}

describe("document tools", () => {
  beforeEach(() => {
    mocks.uploads.clear();
  });

  it("exposes create then update and describes when to use them", () => {
    expect(Object.keys(tools())).toEqual([...DOCUMENT_TOOL_ORDER]);
    expect(DOCUMENT_TOOL_PROMPT).toContain("create_document");
    expect(DOCUMENT_TOOL_PROMPT).toContain("update_document");
  });

  it("creates versioned documents with readable, unique ids", async () => {
    const documentTools = tools();
    const first = await create(documentTools, {
      title: "Q3 Launch Plan!",
      type: "markdown",
      content: "# Plan",
    });
    expect(first).toEqual({
      id: "q3-launch-plan",
      title: "Q3 Launch Plan!",
      type: "markdown",
      version: 1,
      content: "# Plan",
    });
    const second = await create(documentTools, {
      title: "Q3 launch plan",
      type: "code",
      language: "python",
      content: "print('hi')",
    });
    expect(second).toMatchObject({ id: "q3-launch-plan-2", language: "python" });
    const accented = await create(documentTools, {
      title: "Résumé — Ünïcode ✓",
      type: "html",
      language: "ignored",
      content: "<p>hi</p>",
    });
    expect(accented.id).toBe("resume-unicode");
    expect(accented).not.toHaveProperty("language");
    const symbols = await create(documentTools, { title: "✓✓✓", type: "svg", content: "<svg/>" });
    expect(symbols.id).toBe("document");
    expect(
      await documentTools.create_document.toModelOutput!({
        toolCallId: "c",
        input: { title: "x", type: "markdown" },
        output: first,
      }),
    ).toEqual({
      type: "text",
      value:
        'Created document "q3-launch-plan" ("Q3 Launch Plan!", version 1). It is shown beside the chat; use this id to update it.',
    });
  });

  it("requires exactly one source and limits size", async () => {
    await expect(
      create(tools(), { title: "Empty", type: "markdown" }),
    ).rejects.toThrow("Provide exactly one of content or from_file.");
    await expect(
      create(tools(), { title: "Both", type: "markdown", content: "a", from_file: "a.md" }),
    ).rejects.toThrow("Provide exactly one of content or from_file.");
  });

  it("starts from an attached text file", async () => {
    mocks.uploads.set("notes", { extractedText: "# Notes\nDraft", truncated: false });
    mocks.uploads.set("huge", { extractedText: "cut", truncated: true });
    const history: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "file", url: "/api/uploads/notes", mediaType: "text/markdown", filename: "notes.md" },
          { type: "file", url: "/api/uploads/huge", mediaType: "text/plain", filename: "huge.txt" },
          { type: "file", url: "/api/uploads/pic", mediaType: "image/png", filename: "pic.png" },
        ],
      },
    ];
    const documentTools = tools(history);
    await expect(
      create(documentTools, { title: "Notes", type: "markdown", from_file: "NOTES.md" }),
    ).resolves.toMatchObject({ content: "# Notes\nDraft", version: 1 });
    await expect(
      create(documentTools, { title: "Pic", type: "markdown", from_file: "pic.png" }),
    ).rejects.toThrow('No text file named "pic.png" is attached to this conversation. Attached documents: "notes.md", "huge.txt".');
    await expect(
      create(documentTools, { title: "Huge", type: "markdown", from_file: "huge.txt" }),
    ).rejects.toThrow("longer than the extraction limit");
    await expect(
      create(tools(), { title: "None", type: "markdown", from_file: "x.md" }),
    ).rejects.toThrow("No text files are attached to this conversation.");
  });

  it("applies exact edits in order as the next version", async () => {
    const documentTools = tools();
    await create(documentTools, {
      title: "Letter",
      type: "markdown",
      content: "Dear Sam,\nThe meeting is on Monday.\nBest,\nAlex",
    });
    const revised = await update(documentTools, {
      id: "letter",
      edits: [
        { find: "Monday", replace: "Tuesday" },
        { find: "on Tuesday", replace: "on Tuesday at 10am" },
      ],
    });
    expect(revised).toMatchObject({
      id: "letter",
      title: "Letter",
      version: 2,
      content: "Dear Sam,\nThe meeting is on Tuesday at 10am.\nBest,\nAlex",
    });
    const renamed = await update(documentTools, { id: "Letter", title: "Letter to Sam" });
    expect(renamed).toMatchObject({ version: 3, title: "Letter to Sam", content: revised.content });
    const rewritten = await update(documentTools, { id: "letter", content: "Hi Sam" });
    expect(rewritten).toMatchObject({ version: 4, title: "Letter to Sam", content: "Hi Sam" });
    expect(
      await documentTools.update_document.toModelOutput!({
        toolCallId: "c",
        input: { id: "letter" },
        output: rewritten,
      }),
    ).toEqual({ type: "text", value: 'Updated document "letter" to version 4.' });
  });

  it("rejects ambiguous or missing edits without changing the document", async () => {
    const documentTools = tools();
    await create(documentTools, {
      title: "List",
      type: "markdown",
      content: "- item\n- item\n- other",
    });
    await expect(
      update(documentTools, { id: "list", edits: [{ find: "item", replace: "x" }] }),
    ).rejects.toThrow(
      'Edit 1: the find text occurs 2 times in "list". No edits were applied. Include surrounding text so it matches exactly once.',
    );
    await expect(
      update(documentTools, {
        id: "list",
        edits: [
          { find: "other", replace: "last" },
          { find: "missing", replace: "x" },
        ],
      }),
    ).rejects.toThrow(
      'Edit 2: the find text does not occur in "list". No edits were applied. Copy the text exactly from the latest version:\n- item\n- item\n- last',
    );
    const next = await update(documentTools, {
      id: "list",
      edits: [{ find: "- other", replace: "- final" }],
    });
    expect(next).toMatchObject({ version: 2, content: "- item\n- item\n- final" });
  });

  it("validates update requests", async () => {
    const documentTools = tools();
    await create(documentTools, { title: "A", type: "markdown", content: "a" });
    await expect(update(documentTools, { id: "a" })).rejects.toThrow(
      "Provide edits, content, or a new title.",
    );
    await expect(
      update(documentTools, { id: "a", content: "b", edits: [{ find: "a", replace: "b" }] }),
    ).rejects.toThrow("Provide edits or content, not both.");
    await expect(update(documentTools, { id: "missing", content: "x" })).rejects.toThrow(
      'No document has the id "missing". Documents in this conversation: "a".',
    );
    await expect(update(tools(), { id: "a", content: "x" })).rejects.toThrow(
      "This conversation has no documents yet. Use create_document first.",
    );
    await expect(
      update(documentTools, { id: "a", content: "x".repeat(400_001) }),
    ).rejects.toThrow("Documents are limited to 400000 characters.");
  });

  it("continues from the latest saved version in history", async () => {
    const v1 = { id: "plan", title: "Plan", type: "markdown" as const, version: 1, content: "one" };
    const v2 = { ...v1, version: 2, content: "two" };
    const documentTools = tools([savedVersion(v1, "c1"), savedVersion(v2, "c2", "update")]);
    const next = await update(documentTools, { id: "plan", edits: [{ find: "two", replace: "three" }] });
    expect(next).toEqual({ ...v1, version: 3, content: "three" });
    expect(next).not.toHaveProperty("messageId");
    const created = await create(documentTools, { title: "Plan", type: "markdown", content: "new" });
    expect(created.id).toBe("plan-2");
  });

  it("applies parallel revisions one after another", async () => {
    const documentTools = tools();
    await create(documentTools, { title: "Count", type: "markdown", content: "0" });
    const [a, b, c] = await Promise.all([
      update(documentTools, { id: "count", edits: [{ find: "0", replace: "1" }] }),
      update(documentTools, { id: "count", edits: [{ find: "1", replace: "2" }] }),
      update(documentTools, { id: "count", edits: [{ find: "9", replace: "x" }] }).catch((error: Error) => error),
    ]);
    expect([a.version, a.content, b.version, b.content]).toEqual([2, "1", 3, "2"]);
    expect(c).toBeInstanceOf(Error);
    await expect(
      update(documentTools, { id: "count", edits: [{ find: "2", replace: "3" }] }),
    ).resolves.toMatchObject({ version: 4, content: "3" });
  });

  it("rejects malformed stored outputs during replay", async () => {
    expect(
      await tools().update_document.toModelOutput!({
        toolCallId: "c",
        input: { id: "x" },
        output: { id: "x" } as never,
      }),
    ).toEqual({ type: "error-text", value: "This document is unavailable." });
  });
});
