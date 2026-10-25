import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  collectDocumentVersions,
  documentExtension,
  documentFilename,
  documentIdOf,
  documentMediaType,
  documentView,
  findDocumentPart,
  followLiveDocuments,
  groupMessageParts,
  isDocumentOutput,
  type DocumentToolPart,
} from "@overtchat/shared";

const plan = { id: "plan", title: "Plan", type: "markdown" as const, content: "one" };

function part(
  toolCallId: string,
  overrides: Partial<DocumentToolPart> & Pick<DocumentToolPart, "state">,
): DocumentToolPart {
  return { type: "tool-create_document", toolCallId, ...overrides };
}

function assistant(id: string, parts: DocumentToolPart[]): UIMessage {
  return { id, role: "assistant", parts: parts as UIMessage["parts"] };
}

const history = [
  assistant("a1", [part("c1", { state: "output-available", output: { ...plan, version: 1 } })]),
  { id: "u2", role: "user" as const, parts: [{ type: "text" as const, text: "Shorter please" }] },
  assistant("a2", [
    part("c2", {
      type: "tool-update_document",
      state: "output-available",
      input: { id: "plan" },
      output: { ...plan, version: 2, content: "two" },
    }),
    part("c3", { type: "tool-update_document", state: "output-error", input: { id: "plan" }, errorText: "nope" }),
    part("c4", {
      state: "output-available",
      output: { id: "other", title: "Other", type: "code", language: "py", version: 1, content: "x" },
    }),
  ]),
];

describe("document versions", () => {
  it("collects saved versions per document in conversation order", () => {
    const versions = collectDocumentVersions(history);
    expect([...versions.keys()]).toEqual(["plan", "other"]);
    expect(versions.get("plan")).toEqual([
      { ...plan, version: 1, messageId: "a1", toolCallId: "c1" },
      { ...plan, version: 2, content: "two", messageId: "a2", toolCallId: "c2" },
    ]);
  });

  it("ignores malformed or unfinished outputs", () => {
    expect(isDocumentOutput({ ...plan, version: 0 })).toBe(false);
    expect(isDocumentOutput({ ...plan, version: 1, type: "pdf" })).toBe(false);
    expect(isDocumentOutput({ ...plan, version: 1, language: 3 })).toBe(false);
    expect(
      collectDocumentVersions([
        assistant("a", [
          part("x", { state: "input-available", input: { title: "Draft" } }),
          part("y", { state: "output-available", output: { id: "", title: "t" } as never }),
        ]),
      ]).size,
    ).toBe(0);
  });

  it("names downloads by title and type", () => {
    expect(documentFilename({ title: "Q3: plan / draft?", type: "markdown" })).toBe("Q3 plan draft.md");
    expect(documentFilename({ title: "...", type: "html" })).toBe("document.html");
    expect(documentFilename({ title: "  ", type: "mermaid" })).toBe("document.mmd");
    expect(documentFilename({ title: "x".repeat(100), type: "svg" })).toBe(`${"x".repeat(80)}.svg`);
    expect(documentExtension({ type: "code", language: "Python" })).toBe("py");
    expect(documentExtension({ type: "code", language: "brainfuck" })).toBe("txt");
    expect(documentExtension({ type: "code" })).toBe("txt");
    expect(documentMediaType({ type: "svg" })).toBe("image/svg+xml");
    expect(documentMediaType({ type: "code", language: "python" })).toBe("text/plain");
  });

  it("renders documents as their own message segments", () => {
    const message = assistant("a", [
      { type: "reasoning", text: "Planning" } as never,
      part("c1", { state: "output-available", output: { ...plan, version: 1 } }),
      { type: "text", text: "Here it is." } as never,
    ]);
    expect(groupMessageParts(message.parts).map((segment) => segment.kind)).toEqual([
      "activity",
      "document",
      "text",
    ]);
  });
});

describe("document panel view", () => {
  it("shows a saved version with its siblings", () => {
    expect(documentView(history, "c2")).toMatchObject({
      index: 1,
      versions: [{ version: 1 }, { version: 2 }],
    });
    expect(documentView(history, "c4")).toMatchObject({ index: 0, versions: [{ id: "other" }] });
    expect(documentView(history, "missing")).toBeNull();
  });

  it("shows a failed revision as the latest saved version", () => {
    expect(documentView(history, "c3")).toMatchObject({ index: 1, versions: [{}, {}] });
    expect(documentView(history, "c3")).not.toHaveProperty("updating");
    expect(
      documentView([assistant("a", [part("x", { state: "output-error", errorText: "bad" })])], "x"),
    ).toBeNull();
  });

  it("shows a first version while it is written", () => {
    const writing = [
      assistant("a", [
        part("draft", {
          state: "input-streaming",
          input: { title: " Notes ", type: "code", language: "ts", content: "const a" },
        }),
      ]),
    ];
    expect(documentView(writing, "draft")).toEqual({
      versions: [],
      index: -1,
      draft: { title: "Notes", type: "code", language: "ts", content: "const a" },
    });
    const untitled = [assistant("a", [part("d", { state: "input-streaming", input: { type: "pdf" as never } })])];
    expect(documentView(untitled, "d")?.draft).toEqual({
      title: "Untitled document",
      type: "markdown",
      content: "",
    });
  });

  it("keeps the latest version visible while a revision is written", () => {
    const messages = [
      ...history,
      assistant("a3", [
        part("c5", { type: "tool-update_document", state: "input-streaming", input: { id: "plan" } }),
      ]),
    ];
    expect(documentView(messages, "c5")).toMatchObject({ index: 1, updating: true });
    expect(documentIdOf(findDocumentPart(messages, "c5")!)).toBe("plan");
    expect(
      documentView(
        [assistant("a", [part("u", { type: "tool-update_document", state: "input-streaming", input: {} })])],
        "u",
      ),
    ).toBeNull();
  });
});

describe("following a live reply", () => {
  const live = assistant("live", [
    part("n1", { state: "input-streaming", input: { title: "New" } }),
    part("u1", { type: "tool-update_document", state: "input-streaming", input: {} }),
    part("u2", { type: "tool-update_document", state: "input-available", input: { id: "plan" } }),
    part("e1", { state: "output-error", errorText: "bad" }),
  ]);

  it("opens new documents and follows revisions of the open one", () => {
    expect(followLiveDocuments(live, new Set(), undefined, true)).toEqual({
      handled: ["n1", "u2", "e1"],
      follow: "u2",
    });
    expect(followLiveDocuments(live, new Set(), "other", false)).toEqual({
      handled: ["n1", "u2", "e1"],
      follow: "n1",
    });
    expect(followLiveDocuments(live, new Set(["n1"]), "plan", false)).toEqual({
      handled: ["u2", "e1"],
      follow: "u2",
    });
  });

  it("leaves a closed panel closed on narrow screens", () => {
    expect(followLiveDocuments(live, new Set(), undefined, false)).toEqual({
      handled: ["n1", "u2", "e1"],
    });
  });

  it("waits for a revision's target and ignores handled calls and user messages", () => {
    expect(followLiveDocuments(live, new Set(["n1", "u2", "e1"]), "plan", true)).toEqual({ handled: [] });
    expect(
      followLiveDocuments({ id: "u", role: "user", parts: [] }, new Set(), undefined, true),
    ).toEqual({ handled: [] });
    expect(followLiveDocuments(undefined, new Set(), undefined, true)).toEqual({ handled: [] });
  });
});
