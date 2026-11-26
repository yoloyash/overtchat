import { expect, it, vi } from "vitest";
import { i18n } from "@overtchat/shared/i18n";

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
    ].map((mediaType) => humanMediaLabel(mediaType, i18n.t)),
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
