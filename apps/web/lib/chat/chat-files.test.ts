import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactCount, readFileRangeLabel } from "@overtchat/shared";
import {
  allocateTokenBudget,
  attachmentTokenBudget,
  findChatFile,
  isDocumentFile,
  listChatFiles,
  readChunkTokens,
  uploadIdFromUrl,
} from "./chat-files";

function file(id: string, filename: string | undefined, mediaType = "application/pdf") {
  return {
    type: "file" as const,
    url: `/api/uploads/${id}`,
    mediaType,
    ...(filename === undefined ? {} : { filename }),
  };
}

function user(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "user", parts };
}

describe("conversation files", () => {
  it("names uploads uniquely in order of first attachment", () => {
    const messages = [
      user("1", [file("a", "report.pdf"), { type: "text", text: "hi" }]),
      user("2", [
        file("b", "Report.pdf"),
        file("a", "report.pdf"),
        file("c", "notes"),
        file("d", "notes"),
      ]),
      user("3", [file("e", "report.pdf"), file("f", "photo.png", "image/png")]),
    ];

    expect(listChatFiles(messages)).toEqual([
      { uploadId: "a", name: "report.pdf", mediaType: "application/pdf" },
      { uploadId: "b", name: "Report (2).pdf", mediaType: "application/pdf" },
      { uploadId: "c", name: "notes", mediaType: "application/pdf" },
      { uploadId: "d", name: "notes (2)", mediaType: "application/pdf" },
      { uploadId: "e", name: "report (3).pdf", mediaType: "application/pdf" },
      { uploadId: "f", name: "photo.png", mediaType: "image/png" },
    ]);
  });

  it("is deterministic when history is replayed", () => {
    const messages = [
      user("1", [file("a", "data.csv", "text/csv")]),
      user("2", [file("b", "data.csv", "text/csv")]),
    ];
    expect(listChatFiles(messages)).toEqual(listChatFiles(structuredClone(messages)));
  });

  it("ignores data URLs and foreign URLs and sanitizes filenames", () => {
    const messages = [
      user("1", [
        { type: "file", url: "data:text/plain;base64,aGk=", mediaType: "text/plain" },
        { type: "file", url: "https://example.com/x.pdf", mediaType: "application/pdf" },
        { type: "file", url: "/api/uploads/../secret", mediaType: "application/pdf" },
        file("a", "../etc/passwd\u0000"),
        file("b", "   "),
        file("c", undefined, "image/jpeg"),
        file("d", ".."),
      ]),
    ];

    expect(listChatFiles(messages).map(({ uploadId, name }) => [uploadId, name])).toEqual([
      ["a", ".._etc_passwd_"],
      ["b", "file"],
      ["c", "image"],
      ["d", "file (2)"],
    ]);
  });

  it("limits names to a filesystem-friendly length", () => {
    const [entry, other] = listChatFiles([
      user("1", [
        file("a", `${"x".repeat(300)}.pdf`),
        file("b", `${"y".repeat(300)}.not-an-extension-at-all`),
      ]),
    ]);
    expect(entry.name).toHaveLength(180);
    expect(entry.name.endsWith("x.pdf")).toBe(true);
    expect(other.name).toBe("y".repeat(180));
  });

  it("resolves names case-insensitively and falls back to upload IDs", () => {
    const files = listChatFiles([
      user("1", [file("abc", "Q3 Report.pdf"), file("def", "photo.png", "image/png")]),
    ]);
    expect(findChatFile(files, " q3 report.PDF ")?.uploadId).toBe("abc");
    expect(findChatFile(files, "def")?.name).toBe("photo.png");
    expect(findChatFile(files, "missing.pdf")).toBeUndefined();
    expect(findChatFile(files, "  ")).toBeUndefined();
    expect(isDocumentFile(files[0])).toBe(true);
    expect(isDocumentFile(files[1])).toBe(false);
  });

  it("extracts upload IDs only from the uploads route", () => {
    expect(uploadIdFromUrl("/api/uploads/a1_B-2")).toBe("a1_B-2");
    expect(uploadIdFromUrl("/api/uploads/a/b")).toBeNull();
    expect(uploadIdFromUrl("/api/uploads/a?download=1")).toBeNull();
    expect(uploadIdFromUrl("https://host/api/uploads/a")).toBeNull();
  });
});

describe("attachment budgets", () => {
  it("uses a fixed share of the model input budget", () => {
    expect(attachmentTokenBudget(undefined)).toBe(16_000);
    expect(attachmentTokenBudget(1_000)).toBe(1_000);
    expect(attachmentTokenBudget(25_600)).toBe(7_680);
    expect(attachmentTokenBudget(102_400)).toBe(30_720);
    expect(attachmentTokenBudget(800_000)).toBe(100_000);
    expect(readChunkTokens(undefined)).toBe(8_000);
    expect(readChunkTokens(4_000)).toBe(1_000);
    expect(readChunkTokens(102_400)).toBe(15_360);
    expect(readChunkTokens(800_000)).toBe(50_000);
  });

  it("gives small documents their full size and splits the rest", () => {
    const sizes = [100, 5_000, 20_000];
    const measured: Array<[number, number]> = [];
    const allocations = allocateTokenBudget(3, 9_000, (index, limit) => {
      measured.push([index, limit]);
      return sizes[index] <= limit ? sizes[index] : limit + 1;
    });
    expect(allocations).toEqual([100, 4_450, 4_450]);
    expect(allocations.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9_000);
    expect(measured[0]).toEqual([0, 3_000]);
  });

  it("returns the measured size when everything fits", () => {
    const sizes = [10, 20, 30];
    expect(
      allocateTokenBudget(3, 1_000, (index) => sizes[index]),
    ).toEqual([10, 20, 30]);
  });

  it("redistributes repeatedly as more documents fit", () => {
    const sizes = [1_000, 2_900, 3_100, 10_000];
    expect(
      allocateTokenBudget(4, 12_000, (index, limit) =>
        sizes[index] <= limit ? sizes[index] : limit + 1,
      ),
    ).toEqual([1_000, 2_900, 3_100, 5_000]);
  });

  it("handles an empty message and a zero budget", () => {
    expect(allocateTokenBudget(0, 1_000, () => 0)).toEqual([]);
    expect(allocateTokenBudget(2, 0, () => 5)).toEqual([0, 0]);
  });
});

describe("read range labels", () => {
  it("formats counts compactly without locale differences", () => {
    expect(compactCount(0)).toBe("0");
    expect(compactCount(999)).toBe("999");
    expect(compactCount(1_000)).toBe("1k");
    expect(compactCount(41_203)).toBe("41k");
    expect(compactCount(9_430)).toBe("9.4k");
    expect(compactCount(999_999)).toBe("1M");
    expect(compactCount(1_250_000)).toBe("1.3M");
    expect(compactCount(-5)).toBe("0");
  });

  it("describes whole and partial reads", () => {
    const base = { file: "a.pdf", uploadId: "a", totalCharacters: 220_114 };
    expect(readFileRangeLabel({ ...base, offset: 0, end: 220_114 })).toBe("whole file");
    expect(
      readFileRangeLabel({ ...base, offset: 41_203, end: 102_450, nextOffset: 102_450 }),
    ).toBe("41k–102k of 220k chars");
  });
});
