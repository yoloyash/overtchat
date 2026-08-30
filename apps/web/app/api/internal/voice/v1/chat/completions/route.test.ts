import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  createModel: vi.fn(),
  getModelConfig: vi.fn(),
  getPersonalization: vi.fn(),
  streamText: vi.fn(),
  verifyTicket: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  streamText: mocks.streamText,
}));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
}));
vi.mock("@/lib/db/personalization", () => ({
  getActivePersonalization: mocks.getPersonalization,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createModel,
}));
vi.mock("@/lib/voice/internal-auth", () => ({
  authorizeVoiceService: mocks.authorize,
}));
vi.mock("@/lib/voice/ticket", () => ({
  verifyVoiceTicket: mocks.verifyTicket,
}));

import { POST, toModelMessages } from "./route";

describe("voice Chat Completions bridge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockReturnValue(true);
    mocks.verifyTicket.mockReturnValue({
      version: 1,
      connectBy: 100,
      expiresAt: 1_000,
      userId: "user-1",
      modelConfigId: "model-1",
      webSearchEnabled: false,
      timeZone: "UTC",
    });
    mocks.getModelConfig.mockResolvedValue({
      id: "model-1",
      enabled: true,
      providerId: "openai",
      apiFormat: "chat-completions",
      baseUrl: "http://model.test/v1",
      apiKey: null,
      model: "local-model",
      providerOptions: null,
      systemPrompt: null,
      toolCallingEnabled: true,
    });
    mocks.getPersonalization.mockResolvedValue(null);
    mocks.createModel.mockReturnValue({ model: {}, providerOptions: undefined });
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Hello there" };
        yield {
          type: "finish",
          totalUsage: { inputTokens: 4, outputTokens: 2 },
        };
      })(),
    });
  });

  it("rejects callers outside the voice service", async () => {
    mocks.authorize.mockReturnValue(false);

    expect((await POST(new Request("http://app.test", { method: "POST" }))).status)
      .toBe(401);
  });

  it("streams OpenAI-compatible chunks from the selected OvertChat model", async () => {
    const response = await POST(
      new Request("http://app.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "signed-ticket",
          stream: true,
          messages: [{ role: "user", content: "Hello" }],
        }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"content":"Hello there"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body).toContain('"prompt_tokens":4');
    expect(body).toContain("data: [DONE]");
    expect(mocks.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "local-model" }),
    );
  });

  it("preserves tool calls and results in Chat Completions history", () => {
    expect(
      toModelMessages([
        {
          role: "assistant",
          tool_calls: [
            {
              id: "call-1",
              function: { name: "web_search", arguments: '{"query":"news"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "result" },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "web_search",
            input: { query: "news" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "web_search",
            output: { type: "text", value: "result" },
          },
        ],
      },
    ]);
  });
});
