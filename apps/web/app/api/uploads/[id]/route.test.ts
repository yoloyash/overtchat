import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUpload: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/uploads", () => ({
  getUpload: mocks.getUpload,
  uploadPath: (id: string) => `/uploads/${id}`,
}));

import { GET } from "./route";

describe("authenticated upload response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-id" } });
    mocks.getUpload.mockResolvedValue({
      mediaType: "image/png",
      category: "image",
      filename: "chart.png",
    });
    mocks.readFile.mockResolvedValue(Uint8Array.from([1, 2, 3]));
  });

  it("prevents browsers from MIME-sniffing stored files", async () => {
    const response = await GET(new Request("http://localhost/api/uploads/id"), {
      params: Promise.resolve({ id: "upload-id" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBe(
      "inline; filename*=UTF-8''chart.png",
    );
    expect(response.headers.get("Content-Length")).toBe("3");
  });

  it("forces non-image artifacts to download", async () => {
    mocks.getUpload.mockResolvedValue({
      mediaType: "text/html",
      category: "artifact",
      filename: "report.html",
    });

    const response = await GET(new Request("http://localhost/api/uploads/id"), {
      params: Promise.resolve({ id: "upload-id" }),
    });

    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename*=UTF-8''report.html",
    );
  });
});
