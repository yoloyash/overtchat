import { describe, expect, it } from "vitest";
import {
  getDataTransferFiles,
  hasDataTransferFiles,
  isSupportedAttachment,
} from "./attachments";

function file(name: string, type = ""): File {
  return new File(["hello"], name, { type });
}

describe("attachment helpers", () => {
  it("accepts supported files by MIME type", () => {
    expect(isSupportedAttachment(file("screenshot.png", "image/png"))).toBe(true);
    expect(isSupportedAttachment(file("notes.txt", "text/plain"))).toBe(true);
    expect(isSupportedAttachment(file("report.pdf", "application/pdf"))).toBe(true);
  });

  it("accepts supported files by extension when MIME type is missing", () => {
    expect(isSupportedAttachment(file("report.pdf"))).toBe(true);
    expect(isSupportedAttachment(file("document.docx"))).toBe(true);
    expect(isSupportedAttachment(file("sheet.xlsx"))).toBe(true);
    expect(isSupportedAttachment(file("script.ts"))).toBe(true);
  });

  it("rejects unsupported files", () => {
    expect(isSupportedAttachment(file("archive.zip", "application/zip"))).toBe(false);
    expect(isSupportedAttachment(file("movie.mp4", "video/mp4"))).toBe(false);
  });

  it("detects and extracts file items from a data transfer", () => {
    const png = file("screenshot.png", "image/png");
    const data = {
      types: ["Files"],
      files: [],
      items: [{ kind: "file", getAsFile: () => png }],
    } as unknown as DataTransfer;

    expect(hasDataTransferFiles(data)).toBe(true);
    expect(getDataTransferFiles(data)).toEqual([png]);
  });

  it("skips dropped directories", () => {
    const data = {
      types: ["Files"],
      files: [],
      items: [
        {
          kind: "file",
          webkitGetAsEntry: () => ({ isDirectory: true }),
          getAsFile: () => file("folder"),
        },
      ],
    } as unknown as DataTransfer;

    expect(getDataTransferFiles(data)).toEqual([]);
  });
});
