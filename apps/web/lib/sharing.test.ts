import { describe, expect, it } from "vitest";
import { isGeneratedImage } from "@overtchat/shared";
import {
  isSharedGeneratedImage,
  mapUploadReferences,
  sharedMessages,
} from "./sharing";

describe("shared content projection", () => {
  it("accepts only local, matching share-scoped images for public display, never model replay", () => {
    const image = {
      id: "image-id",
      filename: "image.png",
      mediaType: "image/png",
      url: "/api/share/00000000-0000-4000-8000-000000000000/files/image-id",
    };
    expect(isSharedGeneratedImage(image)).toBe(true);
    expect(isGeneratedImage(image)).toBe(false);
    for (const url of [
      "https://foreign.test/image.png",
      "javascript:alert(1)",
      `${image.url}/extra`,
      image.url.replace("image-id", "another-id"),
    ]) {
      expect(isSharedGeneratedImage({ ...image, url })).toBe(false);
    }
    expect(
      isSharedGeneratedImage({ ...image, mediaType: "image/svg+xml" }),
    ).toBe(false);
  });

  it("rewrites references in file parts, generated images, Markdown, and OpenUI without mutating the source", () => {
    const original = {
      parts: [
        { url: "/api/uploads/image" },
        { input: { ui: 'root = Image("/api/uploads/image")' } },
        { text: "![picture](/api/uploads/image)" },
      ],
    };
    const result = mapUploadReferences(
      original,
      (id) => `/api/share/token/files/${id}`,
    );
    expect(JSON.stringify(result)).not.toContain("/api/uploads/");
    expect(
      JSON.stringify(result).match(/\/api\/share\/token\/files\/image/g),
    ).toHaveLength(3);
    expect(original.parts[0].url).toBe("/api/uploads/image");
  });

  it("does not publish system instructions or hidden compaction checkpoints", () => {
    expect(
      sharedMessages([
        {
          id: "system",
          role: "system",
          parts: [{ type: "text", text: "private instructions" }],
        },
        {
          id: "checkpoint",
          role: "user",
          parts: [{ type: "text", text: "internal summary" }],
          metadata: { contextStatus: "manual-compacted" },
        },
      ]),
    ).toEqual([]);
  });
});
