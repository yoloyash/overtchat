import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listAnthropicModels,
  listGoogleModels,
  listLlamaCppModels,
  listOpenAIModels,
} from "./http";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider model discovery", () => {
  it("lists OpenAI-shaped models with bearer authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          {
            id: "z-model",
            max_model_len: 131_072,
            max_context_length: 65_536,
            max_output_tokens: 8192,
            input_modalities: ["text", "image"],
            output_modalities: ["text"],
            capabilities: {
              tool_call: true,
              structured_output: { supported: true },
            },
          },
          { id: "models/a-model", max_context_length: 32_768 },
          {
            id: "unknown-limit",
            max_model_len: 0,
            max_context_length: "not-a-number",
          },
          { id: "" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listOpenAIModels("https://api.example.test/v1/", "secret"),
    ).resolves.toEqual([
      { id: "a-model", contextWindow: 32_768 },
      { id: "unknown-limit" },
      {
        id: "z-model",
        contextWindow: 131_072,
        capabilities: {
          maxOutputTokens: 8192,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          toolCalling: true,
          structuredOutput: true,
        },
      },
    ]);
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
          data: [
            {
              id: "claude-b",
              max_input_tokens: 200_000,
              max_tokens: 64_000,
              capabilities: {
                image_input: { supported: true },
                pdf_input: { supported: false },
                thinking: { supported: true },
                structured_outputs: { supported: true },
              },
            },
          ],
          has_more: true,
          last_id: "claude-b",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            { id: "claude-a", max_input_tokens: 1_000_000 },
            { id: "claude-unknown", max_input_tokens: -1 },
          ],
          has_more: false,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listAnthropicModels("https://api.anthropic.test/v1", "secret"),
    ).resolves.toEqual([
      { id: "claude-a", contextWindow: 1_000_000 },
      {
        id: "claude-b",
        contextWindow: 200_000,
        capabilities: {
          maxOutputTokens: 64_000,
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          attachment: true,
          reasoning: true,
          structuredOutput: true,
        },
      },
      { id: "claude-unknown" },
    ]);
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
            inputTokenLimit: 1_048_576,
            outputTokenLimit: 65_536,
            thinking: true,
            maxTemperature: 2,
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/gemini-unknown",
            inputTokenLimit: null,
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/text-embedding",
            inputTokenLimit: 2_048,
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
    ).resolves.toEqual([
      {
        id: "gemini-pro",
        contextWindow: 1_048_576,
        capabilities: {
          maxOutputTokens: 65_536,
          reasoning: true,
          temperature: true,
        },
      },
      { id: "gemini-unknown" },
    ]);
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

  it("uses llama.cpp runtime properties instead of training metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "local-model",
              owned_by: "llamacpp",
              meta: { n_ctx_train: 131_072 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          default_generation_settings: { n_ctx: 32_768 },
          chat_template_caps: {
            supports_tools: true,
            supports_preserve_reasoning: false,
          },
          modalities: { vision: true },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listOpenAIModels("http://localhost:8080/v1", null),
    ).resolves.toEqual([
      {
        id: "local-model",
        contextWindow: 32_768,
        capabilities: {
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          attachment: true,
          toolCalling: true,
          reasoning: false,
          temperature: true,
        },
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/props?model=local-model",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("probes llama.cpp properties from the explicit preset without ownership metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "proxied-model", owned_by: "local-proxy" }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          default_generation_settings: { n_ctx: 16_384 },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listLlamaCppModels("http://localhost:8080/v1", "local-secret"),
    ).resolves.toEqual([
      {
        id: "proxied-model",
        contextWindow: 16_384,
        capabilities: { temperature: true },
      },
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/props?model=proxied-model",
      expect.objectContaining({
        headers: { Authorization: "Bearer local-secret" },
      }),
    );
  });
});
