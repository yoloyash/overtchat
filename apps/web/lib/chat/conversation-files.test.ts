import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { conversationFiles, type CodeExecutionFile } from "@overtchat/shared";

const chart: CodeExecutionFile = {
  id: "chart",
  url: "/api/uploads/chart",
  name: "chart.png",
  mediaType: "image/png",
  size: 2048,
};

function message(id: string, role: UIMessage["role"], parts: unknown[]): UIMessage {
  return { id, role, parts } as UIMessage;
}

function document(toolCallId: string, id: string, version: number, title = "Plan") {
  return {
    type: version === 1 ? "tool-create_document" : "tool-update_document",
    toolCallId,
    state: "output-available",
    output: { id, title, type: "markdown", version, content: `v${version}` },
  };
}

describe("conversationFiles", () => {
  it("lists outputs and uploads, most recent first", () => {
    const files = conversationFiles([
      message("u1", "user", [
        { type: "file", url: "/api/uploads/photo", mediaType: "image/jpeg", filename: "photo.jpg" },
        { type: "text", text: "Blur it" },
      ]),
      message("a1", "assistant", [
        {
          type: "tool-run_python",
          toolCallId: "run",
          state: "output-available",
          output: { exitCode: 0, timedOut: false, durationMs: 5, stdout: "", stderr: "", files: [chart] },
        },
        {
          type: "tool-generate_image",
          toolCallId: "image",
          state: "output-available",
          output: {
            images: [
              { id: "art", url: "/api/uploads/art", mediaType: "image/webp", filename: "art.webp" },
            ],
          },
        },
      ]),
      message("u2", "user", [
        { type: "file", url: "/api/uploads/notes", mediaType: "text/plain" },
      ]),
    ]);
    expect(files.outputs).toEqual([
      {
        kind: "file",
        file: { id: "art", url: "/api/uploads/art", name: "art.webp", mediaType: "image/webp" },
      },
      { kind: "file", file: chart },
    ]);
    expect(files.uploads).toEqual([
      { id: "notes", url: "/api/uploads/notes", name: "Attachment", mediaType: "text/plain" },
      { id: "photo", url: "/api/uploads/photo", name: "photo.jpg", mediaType: "image/jpeg" },
    ]);
  });

  it("lists a document once, at its latest version and where it last changed", () => {
    const files = conversationFiles([
      message("a1", "assistant", [document("first", "doc", 1), document("other", "doc-2", 1, "Other")]),
      message("a2", "assistant", [document("second", "doc", 2)]),
    ]);
    expect(
      files.outputs.map((output) =>
        output.kind === "document"
          ? [output.document.title, output.document.version, output.document.toolCallId]
          : null,
      ),
    ).toEqual([
      ["Plan", 2, "second"],
      ["Other", 1, "other"],
    ]);
  });

  it("skips unfinished calls, malformed outputs and files outside saved uploads", () => {
    const files = conversationFiles([
      message("u1", "user", [
        { type: "file", url: "data:image/png;base64,AAAA", mediaType: "image/png" },
        { type: "file", url: "https://example.com/a.pdf", mediaType: "application/pdf" },
      ]),
      message("a1", "assistant", [
        { type: "tool-run_python", toolCallId: "running", state: "input-available" },
        {
          type: "tool-run_python",
          toolCallId: "bad",
          state: "output-available",
          output: { files: [{ ...chart, url: "https://example.com/chart.png" }] },
        },
        { ...document("draft", "doc", 1), state: "input-streaming", output: undefined },
        {
          type: "tool-edit_image",
          toolCallId: "image",
          state: "output-available",
          output: { images: [{ id: "x", url: "/elsewhere/x", mediaType: "image/png", filename: "x.png" }] },
        },
      ]),
    ]);
    expect(files).toEqual({ outputs: [], uploads: [] });
  });
});
