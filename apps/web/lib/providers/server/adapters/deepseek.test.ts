import { generateText, tool } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { deepSeekAdapter, prepareDeepSeekRequest } from "./deepseek";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeek adapter", () => {
  it("omits forced tool choice in thinking mode", () => {
    expect(
      prepareDeepSeekRequest({
        model: "deepseek-v4-flash",
        tool_choice: "required",
        thinking: { type: "enabled" },
      }),
    ).toEqual({
      model: "deepseek-v4-flash",
      thinking: { type: "enabled" },
    });

    const automatic = {
      model: "deepseek-v4-flash",
      tool_choice: "auto",
      thinking: { type: "enabled" },
    };
    expect(prepareDeepSeekRequest(automatic)).toBe(automatic);

    const nonThinking = {
      model: "deepseek-v4-flash",
      tool_choice: "required",
      thinking: { type: "disabled" },
    };
    expect(prepareDeepSeekRequest(nonThinking)).toBe(nonThinking);
  });

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

  it("applies thinking-mode compatibility to the serialized request", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            error: {
              message: "intentional test response",
              type: "invalid_request_error",
              param: null,
              code: null,
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          },
        );
      }),
    );
    const resolved = deepSeekAdapter.createLanguageModel({
      providerId: "deepseek",
      apiFormat: "auto",
      baseUrl: "https://api.deepseek.com",
      apiKey: "secret",
      model: "deepseek-v4-flash",
      providerOptions: null,
    });

    await expect(
      generateText({
        model: resolved.model,
        prompt: "Search for overtchat.",
        tools: {
          web_search: tool({
            description: "Search the web.",
            inputSchema: z.object({ query: z.string() }),
          }),
        },
        toolChoice: "required",
      }),
    ).rejects.toThrow("intentional test response");

    expect(requestBody).toMatchObject({
      model: "deepseek-v4-flash",
      tools: [expect.objectContaining({ type: "function" })],
    });
    expect(requestBody).not.toHaveProperty("tool_choice");
  });
});
