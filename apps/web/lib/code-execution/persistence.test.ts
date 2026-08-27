import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CodeExecutionOutput } from "@overtchat/shared";

const mocks = vi.hoisted(() => ({ releasePythonOutput: vi.fn() }));
vi.mock("./browser-python", () => ({
  releasePythonOutput: mocks.releasePythonOutput,
}));

import { persistPythonOutput } from "./persistence";

const localOutput: CodeExecutionOutput = {
  stdout: "done\n",
  stderr: null,
  result: null,
  outputs: [
    {
      kind: "file",
      name: "report.csv",
      mediaType: "text/csv",
      byteLength: 8,
      url: "blob:report",
    },
  ],
};

describe("automatic code artifact persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces browser-local URLs with authenticated upload references", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("value\n1", { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          artifacts: [
            {
              kind: "file",
              name: "report.csv",
              mediaType: "text/csv",
              byteLength: 8,
              url: "/api/uploads/saved-id",
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(persistPythonOutput(localOutput)).resolves.toMatchObject({
      stdout: "done\n",
      outputs: [{ url: "/api/uploads/saved-id" }],
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "blob:report");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/code-execution/artifacts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.releasePythonOutput).toHaveBeenCalledWith(localOutput);
  });

  it("releases local blobs when the server rejects persistence", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("value\n1", { status: 200 }))
        .mockResolvedValueOnce(
          Response.json({ error: "Generated files exceed 50 MB total." }, { status: 413 }),
        ),
    );

    await expect(persistPythonOutput(localOutput)).rejects.toThrow(
      "Generated files exceed 50 MB total.",
    );
    expect(mocks.releasePythonOutput).toHaveBeenCalledWith(localOutput);
  });
});
