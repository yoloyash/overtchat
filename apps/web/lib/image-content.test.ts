import { describe, expect, it } from "vitest";
import { assertFetchedImageContent } from "./image-content";

describe("fetched image content validation", () => {
  it.each([
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", [0xff, 0xd8, 0xff, 0xe0]],
    ["image/gif", [...new TextEncoder().encode("GIF89a")]],
    [
      "image/webp",
      [
        ...new TextEncoder().encode("RIFF"),
        0,
        0,
        0,
        0,
        ...new TextEncoder().encode("WEBP"),
      ],
    ],
  ])("accepts valid %s bytes", (mediaType, bytes) => {
    expect(() =>
      assertFetchedImageContent(Uint8Array.from(bytes), mediaType),
    ).not.toThrow();
  });

  it("rejects a declared image whose bytes do not match", () => {
    expect(() =>
      assertFetchedImageContent(
        new TextEncoder().encode("<script>alert(1)</script>"),
        "image/png",
      ),
    ).toThrow("do not match image/png");
  });

  it("rejects a supported signature under the wrong declared type", () => {
    expect(() =>
      assertFetchedImageContent(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
        "image/png",
      ),
    ).toThrow("do not match image/png");
  });

  it("rejects image types outside the product allowlist", () => {
    expect(() =>
      assertFetchedImageContent(
        new TextEncoder().encode("<svg/>"),
        "image/svg+xml",
      ),
    ).toThrow("Unsupported fetched image type");
  });
});
