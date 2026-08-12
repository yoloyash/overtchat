import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deepSeekAdapter } from "./deepseek";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeek adapter", () => {
  it("discovers models through the authenticated OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        object: "list",
        data: [
          {
            id: "deepseek-v4-flash",
            object: "model",
            owned_by: "deepseek",
          },
          {
            id: "deepseek-v4-pro",
            object: "model",
            owned_by: "deepseek",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deepSeekAdapter.listModels({
        providerId: "deepseek",
        apiFormat: "auto",
        baseUrl: "https://api.deepseek.com",
        apiKey: "secret",
      }),
    ).resolves.toEqual([
      { id: "deepseek-v4-flash" },
      { id: "deepseek-v4-pro" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
      }),
    );
  });
});
