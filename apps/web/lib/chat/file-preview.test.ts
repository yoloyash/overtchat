import { describe, expect, it } from "vitest";
import { filePreview, parseDelimited } from "./file-preview";

describe("file previews", () => {
  it("previews the types the panel can show and downloads the rest", () => {
    const kinds = Object.fromEntries(
      [
        "image/png",
        "image/svg+xml",
        "application/pdf",
        "text/csv",
        "text/tab-separated-values",
        "text/markdown",
        "text/html",
        "text/x-python",
        "application/json",
        "audio/mpeg",
        "video/mp4",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
        "application/octet-stream",
      ].map((mediaType) => [mediaType, filePreview({ mediaType })]),
    );
    expect(kinds).toEqual({
      "image/png": { kind: "image" },
      "image/svg+xml": { kind: "image" },
      "application/pdf": { kind: "pdf" },
      "text/csv": { kind: "table", delimiter: "," },
      "text/tab-separated-values": { kind: "table", delimiter: "\t" },
      "text/markdown": { kind: "markdown" },
      "text/html": { kind: "html" },
      "text/x-python": { kind: "text", language: "python" },
      "application/json": { kind: "text", language: "json" },
      "audio/mpeg": { kind: "audio" },
      "video/mp4": { kind: "video" },
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": null,
      "application/zip": null,
      "application/octet-stream": null,
    });
  });

  it("parses quoted fields, line endings and a byte order mark", () => {
    expect(
      parseDelimited('﻿region,note\r\nnorth,"7, up"\r\nsouth,"said ""hi""\nthen left"\n', ","),
    ).toEqual([
      ["region", "note"],
      ["north", "7, up"],
      ["south", 'said "hi"\nthen left'],
    ]);
    expect(parseDelimited("a\tb\n1\t\n", "\t")).toEqual([
      ["a", "b"],
      ["1", ""],
    ]);
    expect(parseDelimited("last,row", ",")).toEqual([["last", "row"]]);
    expect(parseDelimited("", ",")).toEqual([]);
  });
});
