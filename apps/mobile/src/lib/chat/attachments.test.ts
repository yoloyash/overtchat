import { expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({}));

import { humanMediaLabel } from "./attachments";

it("names common file types for people", () => {
  expect(
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/json",
      "application/zip",
      "application/octet-stream",
      "image/png",
      "image/svg+xml",
      "text/x-python",
      "text/csv",
      "application/x-unknown",
      undefined,
    ].map(humanMediaLabel),
  ).toEqual([
    "PowerPoint presentation",
    "JSON",
    "ZIP archive",
    "File",
    "PNG image",
    "SVG image",
    "PYTHON",
    "CSV",
    "application/x-unknown",
    "File",
  ]);
});
