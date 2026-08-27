import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  storeCodeArtifacts: vi.fn(),
}));

vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/db/uploads", () => ({
  storeCodeArtifacts: mocks.storeCodeArtifacts,
}));

import { POST } from "./route";

describe("generated code artifact uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "user-id" } });
    mocks.storeCodeArtifacts.mockResolvedValue([
      {
        kind: "file",
        name: "report.csv",
        mediaType: "text/csv",
        byteLength: 8,
        url: "/api/uploads/artifact-id",
      },
    ]);
  });

  it("persists a bounded batch for the authenticated user", async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["value\n1"], "report.csv", { type: "text/csv" }),
    );

    const response = await POST(
      new Request("http://localhost/api/code-execution/artifacts", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      artifacts: [expect.objectContaining({ url: "/api/uploads/artifact-id" })],
    });
    expect(mocks.storeCodeArtifacts).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: "user-id",
        filename: "report.csv",
        mediaType: "text/csv",
        image: false,
      }),
    ]);
  });

  it("downgrades a forged image to a download-only file", async () => {
    const form = new FormData();
    form.append(
      "files",
      new File(["not png"], "report.png", { type: "image/png" }),
    );

    await POST(
      new Request("http://localhost/api/code-execution/artifacts", {
        method: "POST",
        body: form,
      }),
    );

    expect(mocks.storeCodeArtifacts).toHaveBeenCalledWith([
      expect.objectContaining({ image: false }),
    ]);
  });

  it("rejects unauthenticated and oversized batches", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const unauthorized = await POST(
      new Request("http://localhost/api/code-execution/artifacts", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(unauthorized.status).toBe(401);

    const form = new FormData();
    for (let index = 0; index < 11; index += 1) {
      form.append("files", new File(["x"], `${index}.txt`));
    }
    const oversized = await POST(
      new Request("http://localhost/api/code-execution/artifacts", {
        method: "POST",
        body: form,
      }),
    );
    expect(oversized.status).toBe(413);
    expect(mocks.storeCodeArtifacts).not.toHaveBeenCalled();
  });
});
