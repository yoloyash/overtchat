import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUpload: vi.fn(),
  uploadPath: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({
  default: { readFile: mocks.readFile },
}));
vi.mock("@/lib/db/uploads", () => ({
  getUpload: mocks.getUpload,
  uploadPath: mocks.uploadPath,
}));

import {
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
} from "@/lib/agents/types";
import { resolveAgentImages } from "./images";

const image = {
  uploadId: "11111111-1111-4111-8111-111111111111",
  filename: "client-name.png",
  mediaType: "image/png" as const,
};

describe("agent image resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uploadPath.mockImplementation((id: string) => `/uploads/${id}`);
    mocks.readFile.mockResolvedValue(Buffer.from("image-bytes"));
    mocks.getUpload.mockResolvedValue({
      id: image.uploadId,
      userId: "user",
      filename: "stored-name.png",
      mediaType: "image/png",
      category: "image",
      size: 11,
    });
  });

  it("resolves owner-scoped uploads using authoritative metadata", async () => {
    await expect(resolveAgentImages([image], "user")).resolves.toEqual([
      {
        uploadId: image.uploadId,
        filename: "stored-name.png",
        mediaType: "image/png",
        data: Buffer.from("image-bytes").toString("base64"),
      },
    ]);
    expect(mocks.getUpload).toHaveBeenCalledWith(image.uploadId, "user");
    expect(mocks.readFile).toHaveBeenCalledWith(`/uploads/${image.uploadId}`);
  });

  it("rejects unavailable, non-image, and oversized uploads", async () => {
    mocks.getUpload.mockResolvedValueOnce(null);
    await expect(resolveAgentImages([image], "user")).rejects.toThrow(
      "unavailable",
    );

    mocks.getUpload.mockResolvedValueOnce({
      id: image.uploadId,
      category: "text",
      mediaType: "text/plain",
      size: 10,
    });
    await expect(resolveAgentImages([image], "user")).rejects.toThrow(
      "unavailable",
    );

    mocks.getUpload.mockResolvedValueOnce({
      id: image.uploadId,
      category: "image",
      mediaType: "image/png",
      size: MAX_AGENT_IMAGE_BYTES + 1,
    });
    await expect(resolveAgentImages([image], "user")).rejects.toThrow(
      "10MB",
    );
  });

  it("rejects image batches above the aggregate limit", async () => {
    mocks.getUpload.mockResolvedValue({
      id: image.uploadId,
      filename: "large.png",
      category: "image",
      mediaType: "image/png",
      size: Math.floor(MAX_AGENT_IMAGE_TOTAL_BYTES / 3) + 1,
    });

    await expect(
      resolveAgentImages(
        [
          image,
          {
            ...image,
            uploadId: "22222222-2222-4222-8222-222222222222",
          },
          {
            ...image,
            uploadId: "33333333-3333-4333-8333-333333333333",
          },
        ],
        "user",
      ),
    ).rejects.toThrow("total 20MB");
  });
});
