import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAnthropicModels,
  listGoogleModels,
  listOpenAIModels,
} from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider model discovery", () => {
  it("lists OpenAI-shaped models with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [{ id: "z-model" }, { id: "models/a-model" }, { id: "" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listOpenAIModels("https://api.example.test/v1/", "secret"),
    ).resolves.toEqual(["a-model", "z-model"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer secret" },
      }),
    );
  });

  it("paginates Anthropic models with native headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "claude-b" }],
          has_more: true,
          last_id: "claude-b",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ data: [{ id: "claude-a" }], has_more: false }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAnthropicModels("https://api.anthropic.test/v1", "secret"),
    ).resolves.toEqual(["claude-a", "claude-b"]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.anthropic.test/v1/models?limit=1000&after_id=claude-b",
      expect.objectContaining({
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": "secret",
        },
      }),
    );
  });

  it("returns only Google models that support generateContent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        models: [
          {
            name: "models/gemini-pro",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listGoogleModels(
        "https://generativelanguage.googleapis.test/v1beta",
        "secret",
      ),
    ).resolves.toEqual(["gemini-pro"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.test/v1beta/models?pageSize=1000",
      expect.objectContaining({ headers: { "x-goog-api-key": "secret" } }),
    );
  });

  it("surfaces bounded upstream error details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("invalid credential", {
          status: 401,
          statusText: "Unauthorized",
        }),
      ),
    );

    await expect(
      listOpenAIModels("https://api.example.test/v1", "bad"),
    ).rejects.toThrow("Upstream 401 Unauthorized: invalid credential");
  });
});
