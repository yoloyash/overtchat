import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const webTools = {
    web_search: { description: "search" },
    fetch_url: { description: "fetch" },
  };
  const chatTools = { ...webTools };

  return {
    getSession: vi.fn(),
    parseChatRequest: vi.fn(),
    getChat: vi.fn(),
    clearActiveStreamId: vi.fn(),
    commitChatTurn: vi.fn(),
    completeChatStream: vi.fn(),
    getChatMessage: vi.fn(),
    inlineUploads: vi.fn(),
    getModelConfig: vi.fn(),
    getProject: vi.fn(),
    generateChatTitle: vi.fn(),
    getProvider: vi.fn(),
    modelIconForModel: vi.fn(),
    createConfiguredLanguageModel: vi.fn(),
    cancelRegister: vi.fn(),
    cancelUnregister: vi.fn(),
    cancelHas: vi.fn(),
    getStreamContext: vi.fn(),
    convertToModelMessages: vi.fn(),
    agentStream: vi.fn(),
    isStepCount: vi.fn(),
    toUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
    agentSettings: [] as Array<Record<string, unknown>>,
    agentStreamArgs: [] as Array<Record<string, unknown>>,
    uiStreamOptions: undefined as Record<string, unknown> | undefined,
    responseOptions: undefined as Record<string, unknown> | undefined,
    webTools,
    chatTools,
    toolOrder: ["web_search", "fetch_url"],
    citationPrompt: "stable web citation instruction",
  };
});

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  createUIMessageStreamResponse: mocks.createUIMessageStreamResponse,
  isStepCount: mocks.isStepCount,
  ToolLoopAgent: class MockToolLoopAgent {
    constructor(settings: Record<string, unknown>) {
      mocks.agentSettings.push(settings);
    }

    stream(args: Record<string, unknown>) {
      mocks.agentStreamArgs.push(args);
      return mocks.agentStream(args);
    }
  },
  toUIMessageStream: mocks.toUIMessageStream,
}));
vi.mock("@/lib/tools", () => ({
  chatTools: mocks.chatTools,
  webTools: mocks.webTools,
  CHAT_TOOL_ORDER: mocks.toolOrder,
  WEB_TOOL_NAMES: mocks.toolOrder,
  WEB_SEARCH_CITATION_PROMPT: mocks.citationPrompt,
}));
vi.mock("@/lib/auth/server", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));
vi.mock("@/lib/chat/request", () => {
  class ChatRequestError extends Error {
    readonly status: number;

    constructor(message: string, status = 400) {
      super(message);
      this.name = "ChatRequestError";
      this.status = status;
    }
  }
  return {
    ChatRequestError,
    parseChatRequest: mocks.parseChatRequest,
  };
});
vi.mock("@/lib/db/chats", () => ({ getChat: mocks.getChat }));
vi.mock("@/lib/db/chatTurns", () => ({
  clearActiveStreamId: mocks.clearActiveStreamId,
  commitChatTurn: mocks.commitChatTurn,
  completeChatStream: mocks.completeChatStream,
  getChatMessage: mocks.getChatMessage,
}));
vi.mock("@/lib/db/uploads", () => ({ inlineUploads: mocks.inlineUploads }));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
}));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/title", () => ({
  generateChatTitle: mocks.generateChatTitle,
}));
vi.mock("@/lib/providers/catalog", () => ({
  getProvider: mocks.getProvider,
  modelIconForModel: mocks.modelIconForModel,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createConfiguredLanguageModel,
}));
vi.mock("@/lib/streams/cancel-registry", () => ({
  register: mocks.cancelRegister,
  unregister: mocks.cancelUnregister,
  has: mocks.cancelHas,
}));
vi.mock("@/lib/streams/context", () => ({
  getStreamContext: mocks.getStreamContext,
}));

import { ProviderConfigurationError } from "@/lib/providers/server/errors";
import { POST } from "./route";

const messages = [
  {
    id: "user-message",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Hello" }],
  },
];

const convertedMessages = [{ role: "user", content: "Hello" }];
const parsedRequest = {
  messages,
  modelConfigId: "model-config",
  chatId: "chat",
  forceSearch: false,
  projectId: null,
  trigger: "submit-message" as const,
  messageId: undefined,
  temporary: false,
};

const modelConfig = {
  id: "model-config",
  label: "Test model",
  providerId: "custom" as const,
  apiFormat: "openai-chat" as const,
  baseUrl: "https://example.test/v1",
  apiKey: "key",
  model: "test-model",
  systemPrompt: null,
  providerOptions: null,
  toolCallingEnabled: true,
  enabled: true,
  sortOrder: 0,
};

function request(): Request {
  return new Request("http://server.test/api/chat", {
    method: "POST",
    headers: { Origin: "exp://mobile" },
    body: "{}",
  });
}

function existingChat(activeStreamId: string | null = null) {
  return {
    id: "chat",
    userId: "user",
    projectId: null,
    title: "Existing chat",
    activeStreamId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("chat route setup boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.agentSettings.length = 0;
    mocks.agentStreamArgs.length = 0;
    mocks.uiStreamOptions = undefined;
    mocks.responseOptions = undefined;

    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.parseChatRequest.mockResolvedValue({ ...parsedRequest });
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig });
    mocks.getChat.mockResolvedValue(null);
    mocks.getProject.mockResolvedValue(null);
    mocks.getChatMessage.mockResolvedValue(null);
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "language-model",
      providerOptions: undefined,
      promptCacheStrategy: undefined,
    });
    mocks.inlineUploads.mockResolvedValue(messages);
    mocks.convertToModelMessages.mockResolvedValue(convertedMessages);
    mocks.getProvider.mockReturnValue({
      label: "Custom",
      iconId: null,
    });
    mocks.modelIconForModel.mockReturnValue(null);
    mocks.isStepCount.mockReturnValue("stop-at-50");
    mocks.cancelHas.mockReturnValue(false);
    mocks.commitChatTurn.mockReturnValue("committed");
    mocks.completeChatStream.mockReturnValue(true);
    mocks.clearActiveStreamId.mockResolvedValue(undefined);
    mocks.generateChatTitle.mockResolvedValue(null);
    mocks.getStreamContext.mockReturnValue(null);
    mocks.agentStream.mockImplementation(async () => ({
      stream: new ReadableStream(),
    }));
    mocks.toUIMessageStream.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.uiStreamOptions = options;
        return options.stream;
      },
    );
    mocks.createUIMessageStreamResponse.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.responseOptions = options;
        return new Response("stream", {
          status: 200,
          headers: options.headers as Headers,
        });
      },
    );
  });

  it("returns a CORS-wrapped configuration error without mutating chat", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.createConfiguredLanguageModel.mockImplementation(() => {
      throw new ProviderConfigurationError("unsupported Bedrock model");
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "exp://mobile",
    );
    await expect(response.text()).resolves.toContain(
      "unsupported Bedrock model",
    );
    expect(mocks.inlineUploads).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
    expect(mocks.cancelRegister).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it.each([
    [
      "upload",
      () => mocks.inlineUploads.mockRejectedValue(new Error("ENOENT")),
    ],
    [
      "conversion",
      () =>
        mocks.convertToModelMessages.mockRejectedValue(
          new Error("invalid message"),
        ),
    ],
  ])("does not mutate chat when %s preparation fails", async (_name, fail) => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fail();

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "exp://mobile",
    );
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
    expect(mocks.cancelRegister).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("rejects disabled configurations before provider preparation", async () => {
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig, enabled: false });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("prepares an edit before atomically truncating and replacing it", async () => {
    const events: string[] = [];
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      messageId: "edited-user-message",
    });
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getChatMessage.mockResolvedValue({
      id: "edited-user-message",
      role: "user",
      parts: [{ type: "text", text: "Old" }],
    });
    mocks.createConfiguredLanguageModel.mockImplementation(() => {
      events.push("model");
      return {
        model: "language-model",
        providerOptions: undefined,
        promptCacheStrategy: undefined,
      };
    });
    mocks.inlineUploads.mockImplementation(async () => {
      events.push("uploads");
      return messages;
    });
    mocks.convertToModelMessages.mockImplementation(async () => {
      events.push("convert");
      return convertedMessages;
    });
    mocks.cancelRegister.mockImplementation(() => events.push("register"));
    mocks.commitChatTurn.mockImplementation(() => {
      events.push("commit");
      return "committed";
    });
    mocks.agentStream.mockImplementation(async () => {
      events.push("stream");
      return { stream: new ReadableStream() };
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(events).toEqual([
      "model",
      "uploads",
      "convert",
      "register",
      "commit",
      "stream",
    ]);
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        truncateFromMessageId: "edited-user-message",
        userMessage: { id: "user-message", parts: messages[0].parts },
      }),
    );
  });

  it("unregisters the controller when the atomic claim throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.commitChatTurn.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const response = await POST(request());
    const streamId = mocks.cancelRegister.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(mocks.cancelUnregister).toHaveBeenCalledWith(streamId);
    expect(mocks.agentStream).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("cleans the controller and active claim when stream setup throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.agentStream.mockRejectedValue(new Error("stream setup failed"));

    const response = await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];

    expect(response.status).toBe(500);
    expect(mocks.cancelUnregister).toHaveBeenCalledWith(claim.streamId);
    expect(mocks.clearActiveStreamId).toHaveBeenCalledWith(
      "chat",
      claim.streamId,
    );
    consoleSpy.mockRestore();
  });

  it("persists a partial assistant when the user aborts", async () => {
    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const onEnd = mocks.uiStreamOptions?.onEnd as (
      event: unknown,
    ) => Promise<void>;

    await onEnd({
      isAborted: true,
      responseMessage: {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Partial" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: claim.streamId,
      assistantMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Partial" }],
      },
    });
    expect(mocks.cancelUnregister).toHaveBeenCalledWith(claim.streamId);
  });

  it("does not persist a partial assistant when the provider stream errors", async () => {
    const providerError = new Error("provider failed");
    let observedRead: Promise<ReadableStreamReadResult<unknown>> | undefined;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.agentStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "error", error: providerError });
          controller.close();
        },
      }),
    });
    mocks.toUIMessageStream.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.uiStreamOptions = options;
        const stream = options.stream as ReadableStream<unknown>;
        observedRead = stream.getReader().read();
        return new ReadableStream();
      },
    );

    await POST(request());
    await observedRead;
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const onEnd = mocks.uiStreamOptions?.onEnd as (
      event: unknown,
    ) => Promise<void>;

    await onEnd({
      isAborted: false,
      responseMessage: {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Broken partial" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: claim.streamId,
      assistantMessage: undefined,
    });
    consoleSpy.mockRestore();
  });

  it("does not discard an assistant for an ordinary UI tool error", async () => {
    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const onError = mocks.uiStreamOptions?.onError as (error: unknown) => string;
    const onEnd = mocks.uiStreamOptions?.onEnd as (
      event: unknown,
    ) => Promise<void>;

    expect(onError(new Error("tool execution failed"))).toBe(
      "tool execution failed",
    );
    await onEnd({
      isAborted: false,
      responseMessage: {
        id: "assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Recovered answer" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: claim.streamId,
      assistantMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Recovered answer" }],
      },
    });
  });

  it("does not tee the response stream when resumability is disabled", async () => {
    await POST(request());

    expect(mocks.getStreamContext).toHaveBeenCalledOnce();
    expect(mocks.responseOptions?.consumeSseStream).toBeUndefined();
  });

  it("buffers a response-stream copy when resumability is enabled", async () => {
    const createNewResumableStream = vi.fn().mockResolvedValue(undefined);
    mocks.getStreamContext.mockReturnValue({ createNewResumableStream });

    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const consumeSseStream = mocks.responseOptions?.consumeSseStream as (event: {
      stream: ReadableStream<string>;
    }) => Promise<void>;
    const stream = new ReadableStream<string>();
    await consumeSseStream({ stream });

    expect(createNewResumableStream).toHaveBeenCalledWith(
      claim.streamId,
      expect.any(Function),
    );
    expect(createNewResumableStream.mock.calls[0][1]()).toBe(stream);
  });

  it("blocks a second request while the claimed stream is active", async () => {
    mocks.getChat.mockResolvedValue(existingChat("existing-stream"));
    mocks.cancelHas.mockReturnValue(true);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("uses automatic tools normally and forces only the first requested step", async () => {
    await POST(request());
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      forceSearch: true,
    });
    await POST(request());

    const [automatic, forced] = mocks.agentSettings;
    for (const settings of [automatic, forced]) {
      expect(settings).toEqual(
        expect.objectContaining({
          tools: mocks.chatTools,
          toolOrder: mocks.toolOrder,
          instructions: {
            role: "system",
            content: mocks.citationPrompt,
          },
          toolChoice: "auto",
          stopWhen: "stop-at-50",
        }),
      );
      expect(settings).not.toHaveProperty("runtimeContext");
      expect(settings).not.toHaveProperty("toolApproval");
    }
    expect(automatic.prepareStep).toBeUndefined();
    const prepareStep = forced.prepareStep as (options: {
      stepNumber: number;
    }) => unknown;
    expect(prepareStep({ stepNumber: 0 })).toEqual({
      activeTools: mocks.toolOrder,
      toolChoice: "required",
    });
    expect(prepareStep({ stepNumber: 1 })).toBeUndefined();
    expect(automatic.tools).toBe(forced.tools);
    expect(automatic.instructions).toEqual(forced.instructions);
    expect(mocks.toUIMessageStream.mock.calls[0][0].tools).toBe(
      mocks.chatTools,
    );
    expect(mocks.toUIMessageStream.mock.calls[1][0].tools).toBe(
      mocks.chatTools,
    );
  });

  it.each([
    ["openai", "gpt-5.6-sol"],
    ["bedrock", "openai.gpt-5.6-sol"],
  ] as const)(
    "uses a stable per-chat cache routing key for %s GPT-5.6",
    async (providerId, model) => {
      mocks.getModelConfig.mockResolvedValue({
        ...modelConfig,
        providerId,
        apiFormat: "auto",
        model,
      });
      mocks.createConfiguredLanguageModel.mockReturnValue({
        model: "language-model",
        providerOptions: { openai: { reasoningEffort: "high" } },
        promptCacheStrategy: { kind: "openai" },
      });

      await POST(request());

      expect(mocks.agentSettings[0]).toMatchObject({
        providerOptions: {
          openai: {
            reasoningEffort: "high",
            promptCacheKey: expect.stringMatching(
              /^chat:[A-Za-z0-9_-]{43}$/,
            ),
          },
        },
        instructions: {
          role: "system",
          content: mocks.citationPrompt,
        },
      });
      expect(mocks.agentStreamArgs[0].messages).toBe(convertedMessages);
    },
  );

  it("applies the adapter-provided Anthropic cache strategy", async () => {
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "language-model",
      providerOptions: undefined,
      promptCacheStrategy: {
        kind: "anthropic",
        cacheControl: { type: "ephemeral", ttl: "1h" },
      },
    });

    await POST(request());

    expect(mocks.agentSettings[0].instructions).toEqual({
      role: "system",
      content: mocks.citationPrompt,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral", ttl: "1h" },
        },
      },
    });
    expect(mocks.agentStreamArgs[0].messages).toEqual([
      {
        role: "user",
        content: "Hello",
        providerOptions: {
          anthropic: {
            cacheControl: { type: "ephemeral", ttl: "1h" },
          },
        },
      },
    ]);
    expect(convertedMessages).toEqual([
      { role: "user", content: "Hello" },
    ]);
  });

  it("omits all tool machinery for a tool-incapable model", async () => {
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      toolCallingEnabled: false,
    });

    await POST(request());

    expect(mocks.createConfiguredLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallingEnabled: false }),
    );
    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        model: "language-model",
        instructions: undefined,
      }),
    );
    expect(mocks.agentSettings[0]).not.toHaveProperty("tools");
    expect(mocks.agentSettings[0]).not.toHaveProperty("toolOrder");
    expect(mocks.agentSettings[0]).not.toHaveProperty("toolApproval");
    expect(mocks.agentSettings[0]).not.toHaveProperty("toolChoice");
    expect(mocks.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: undefined }),
    );
  });

  it("keeps prompt content and persisted UI messages unchanged", async () => {
    const originalMessages = structuredClone(messages);

    await POST(request());

    expect(mocks.agentStreamArgs[0].messages).toBe(convertedMessages);
    expect(mocks.uiStreamOptions?.originalMessages).toBe(messages);
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: { id: "user-message", parts: messages[0].parts },
      }),
    );
    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({ userParts: messages[0].parts }),
    );
    expect(messages).toEqual(originalMessages);
    expect(mocks.agentSettings[0]).not.toHaveProperty("runtimeContext");
  });

  it("emits provider cache token details in finish metadata", async () => {
    await POST(request());
    const messageMetadata = mocks.uiStreamOptions?.messageMetadata as (event: {
      part: Record<string, unknown>;
    }) => unknown;

    const metadata = messageMetadata({
      part: {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 100,
          inputTokenDetails: {
            cacheReadTokens: 80,
            cacheWriteTokens: 5,
            noCacheTokens: 15,
          },
          outputTokens: 10,
          totalTokens: 110,
        },
      },
    });

    expect(metadata).toEqual({
      stats: expect.objectContaining({
        contextTokens: 100,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        uncachedInputTokens: 15,
        responseTokens: 10,
        totalTokens: 110,
        finishReason: "stop",
      }),
    });
  });
});
