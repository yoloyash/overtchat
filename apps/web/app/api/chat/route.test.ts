import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/notifications/chat", () => ({ notifyChatComplete: mocks.notifyChatComplete }));
import type { MessageStats } from "@/lib/chat/stats";

const mocks = vi.hoisted(() => {
  const webTools = {
    web_search: { description: "search" },
    fetch_url: { description: "fetch" },
  };
  const chatTools = { ...webTools };

  return {
    notifyChatComplete: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn(),
    parseChatRequest: vi.fn(),
    chatRequestFingerprint: vi.fn(),
    getChat: vi.fn(),
    getMessages: vi.fn(),
    clearActiveStreamId: vi.fn(),
    commitChatTurn: vi.fn(),
    completeChatStream: vi.fn(),
    failChatStream: vi.fn(),
    getChatGeneration: vi.fn(),
    getChatGenerationByRequestId: vi.fn(),
    inlineUploads: vi.fn(),
    getModelConfig: vi.fn(),
    getServerCapability: vi.fn(),
    listEffectiveMcpServers: vi.fn(),
    acquireMcpBinding: vi.fn(),
    releaseMcpBinding: vi.fn(),
    getProject: vi.fn(),
    getActivePersonalization: vi.fn(),
    ensureChatTitle: vi.fn(),
    getProvider: vi.fn(),
    modelIconForModel: vi.fn(),
    catalogEntryFor: vi.fn(),
    catalogPricingFor: vi.fn(),
    resolveModelCapabilities: vi.fn(),
    resolveModelContextWindow: vi.fn(),
    createConfiguredLanguageModel: vi.fn(),
    cancelRegister: vi.fn(),
    cancelUnregister: vi.fn(),
    cancelHas: vi.fn(),
    getStreamContext: vi.fn(),
    resumeChatStreamResponse: vi.fn(),
    currentDateSystemPrompt: vi.fn(),
    consumeStream: vi.fn(),
    generateText: vi.fn(),
    convertToModelMessages: vi.fn(),
    createWebTools: vi.fn(),
    createImageTools: vi.fn(),
    getImageCapability: vi.fn(),
    createMemoryTools: vi.fn(),
    agentStream: vi.fn(),
    isStepCount: vi.fn(),
    toUIMessageStream: vi.fn(),
    createUIMessageStream: vi.fn(),
    createUIMessageStreamResponse: vi.fn(),
    agentSettings: [] as Array<Record<string, unknown>>,
    agentStreamArgs: [] as Array<Record<string, unknown>>,
    uiStreamOptions: undefined as Record<string, unknown> | undefined,
    outerUiStreamOptions: undefined as Record<string, unknown> | undefined,
    uiChunks: [] as Array<Record<string, unknown>>,
    mergedUiStream: undefined as ReadableStream<unknown> | undefined,
    responseOptions: undefined as Record<string, unknown> | undefined,
    responseStream: undefined as ReadableStream<string> | undefined,
    chatTools,
    memoryTools: {
      set_memory: { description: "set memory" },
      delete_memory: { description: "delete memory" },
    },
    toolOrder: ["web_search", "fetch_url"],
    memoryToolOrder: ["set_memory", "delete_memory"],
    citationPrompt: "stable web citation instruction",
    currentDatePrompt: "Current date: 2026-07-22.",
  };
});

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  generateText: mocks.generateText,
  consumeStream: mocks.consumeStream,
  convertToModelMessages: mocks.convertToModelMessages,
  createUIMessageStream: mocks.createUIMessageStream,
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
vi.mock("@/lib/images/tools", () => ({
  createImageTools: mocks.createImageTools,
  getImageCapability: mocks.getImageCapability,
  IMAGE_TOOL_PROMPT: "Image tools",
  withImageReferences: (messages: unknown) => messages,
}));
vi.mock("@/lib/tools", () => ({
  createWebTools: mocks.createWebTools,
  CHAT_TOOL_ORDER: mocks.toolOrder,
  WEB_TOOL_NAMES: mocks.toolOrder,
  WEB_SEARCH_CITATION_PROMPT: mocks.citationPrompt,
}));
vi.mock("@/lib/personalization/tools", () => ({
  createMemoryTools: mocks.createMemoryTools,
  MEMORY_TOOL_ORDER: mocks.memoryToolOrder,
}));
vi.mock("@/lib/chat/current-date", () => ({
  currentDateSystemPrompt: mocks.currentDateSystemPrompt,
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
    chatRequestFingerprint: mocks.chatRequestFingerprint,
    ChatRequestError,
    parseChatRequest: mocks.parseChatRequest,
  };
});
vi.mock("@/lib/db/chats", () => ({
  getChat: mocks.getChat,
  getMessages: mocks.getMessages,
}));
vi.mock("@/lib/db/chatTurns", () => ({
  clearActiveStreamId: mocks.clearActiveStreamId,
  commitChatTurn: mocks.commitChatTurn,
  completeChatStream: mocks.completeChatStream,
  failChatStream: mocks.failChatStream,
  getChatGeneration: mocks.getChatGeneration,
  getChatGenerationByRequestId: mocks.getChatGenerationByRequestId,
}));
vi.mock("@/lib/db/uploads", () => ({ inlineUploads: mocks.inlineUploads }));
vi.mock("@/lib/db/modelConfigs", () => ({
  getModelConfig: mocks.getModelConfig,
}));
vi.mock("@/lib/db/serverCapabilities", () => ({
  getServerCapability: mocks.getServerCapability,
}));
vi.mock("@/lib/db/mcpServers", () => ({
  listEffectiveMcpServers: mocks.listEffectiveMcpServers,
}));
vi.mock("@/lib/mcp/manager", () => ({
  acquireMcpBinding: mocks.acquireMcpBinding,
}));
vi.mock("@/lib/db/projects", () => ({ getProject: mocks.getProject }));
vi.mock("@/lib/db/personalization", () => ({
  getActivePersonalization: mocks.getActivePersonalization,
}));
vi.mock("@/lib/title", () => ({
  ensureChatTitle: mocks.ensureChatTitle,
}));
vi.mock("@/lib/providers/catalog", () => ({
  getProvider: mocks.getProvider,
  modelIconForModel: mocks.modelIconForModel,
}));
vi.mock("@/lib/providers/server/registry", () => ({
  createConfiguredLanguageModel: mocks.createConfiguredLanguageModel,
}));
vi.mock("@/lib/providers/server/model-catalog", () => ({
  catalogEntryFor: mocks.catalogEntryFor,
  catalogPricingFor: mocks.catalogPricingFor,
  resolveModelContextWindow: mocks.resolveModelContextWindow,
  resolveModelCapabilities: mocks.resolveModelCapabilities,
}));
vi.mock("@/lib/streams/cancel-registry", () => ({
  register: mocks.cancelRegister,
  unregister: mocks.cancelUnregister,
  has: mocks.cancelHas,
}));
vi.mock("@/lib/streams/context", () => ({
  getStreamContext: mocks.getStreamContext,
}));
vi.mock("@/lib/streams/http", () => ({
  resumeChatStreamResponse: mocks.resumeChatStreamResponse,
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
  clientRequestId: "client-request",
  webSearchEnabled: true,
  forceSearch: false,
  timeZone: "America/Los_Angeles",
  projectId: null,
  action: { type: "submit" as const },
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
  pricing: null,
  contextWindow: null,
  discoveredContextWindow: null,
  discoveredCapabilities: null,
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
    kind: "text" as const,
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
    mocks.outerUiStreamOptions = undefined;
    mocks.uiChunks.length = 0;
    mocks.mergedUiStream = undefined;
    mocks.responseOptions = undefined;
    mocks.responseStream = undefined;

    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.parseChatRequest.mockResolvedValue({ ...parsedRequest });
    mocks.chatRequestFingerprint.mockReturnValue("request-fingerprint");
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig });
    mocks.getServerCapability.mockReturnValue({ provider: "bundled" });
    mocks.listEffectiveMcpServers.mockResolvedValue([]);
    mocks.releaseMcpBinding.mockResolvedValue(undefined);
    mocks.acquireMcpBinding.mockResolvedValue({
      tools: {},
      release: mocks.releaseMcpBinding,
    });
    mocks.getChat.mockResolvedValue(null);
    mocks.getChatGenerationByRequestId.mockResolvedValue(null);
    mocks.getChatGeneration.mockResolvedValue(null);
    mocks.getMessages.mockResolvedValue([]);
    mocks.getProject.mockResolvedValue(null);
    mocks.getActivePersonalization.mockResolvedValue(null);
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "language-model",
      providerOptions: undefined,
      promptCacheStrategy: undefined,
    });
    mocks.resolveModelCapabilities.mockReturnValue(undefined);
    mocks.createWebTools.mockReturnValue(mocks.chatTools);
    mocks.createImageTools.mockReturnValue({});
    mocks.getImageCapability.mockReturnValue({ available: false, model: null });
    mocks.createMemoryTools.mockReturnValue(mocks.memoryTools);
    mocks.inlineUploads.mockResolvedValue(messages);
    mocks.convertToModelMessages.mockResolvedValue(convertedMessages);
    mocks.getProvider.mockReturnValue({
      label: "Custom",
      iconId: null,
    });
    mocks.modelIconForModel.mockReturnValue(null);
    mocks.resolveModelContextWindow.mockReturnValue(128_000);
    mocks.isStepCount.mockReturnValue("stop-at-50");
    mocks.cancelHas.mockReturnValue(false);
    mocks.commitChatTurn.mockReturnValue("committed");
    mocks.completeChatStream.mockReturnValue(true);
    mocks.failChatStream.mockReturnValue(true);
    mocks.resumeChatStreamResponse.mockResolvedValue(null);
    mocks.clearActiveStreamId.mockResolvedValue(undefined);
    mocks.ensureChatTitle.mockResolvedValue(null);
    mocks.getStreamContext.mockReturnValue(null);
    mocks.currentDateSystemPrompt.mockReturnValue(mocks.currentDatePrompt);
    mocks.consumeStream.mockResolvedValue(undefined);
    mocks.agentStream.mockImplementation(async () => ({
      stream: new ReadableStream(),
    }));
    mocks.toUIMessageStream.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.uiStreamOptions = options;
        return options.stream;
      },
    );
    mocks.createUIMessageStream.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.outerUiStreamOptions = options;
        const execute = options.execute as (event: {
          writer: {
            write(part: Record<string, unknown>): void;
            merge(stream: ReadableStream<unknown>): void;
          };
        }) => void;
        execute({
          writer: {
            write(part) {
              mocks.uiChunks.push(part);
            },
            merge(stream) {
              mocks.mergedUiStream = stream;
            },
          },
        });
        return new ReadableStream();
      },
    );
    mocks.createUIMessageStreamResponse.mockImplementation(
      (options: Record<string, unknown>) => {
        mocks.responseOptions = options;
        const consumeSseStream = options.consumeSseStream as
          | ((event: { stream: ReadableStream<string> }) => Promise<void>)
          | undefined;
        if (consumeSseStream) {
          mocks.responseStream = new ReadableStream<string>();
          void consumeSseStream({ stream: mocks.responseStream });
        }
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

  it("rejects remote attachments before saving or starting a generation", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      messages: [{
        ...messages[0],
        parts: [{ type: "file", mediaType: "image/png", url: "http://internal/image.png" }],
      }],
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Edit the original message");
    expect(mocks.inlineUploads).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
    expect(mocks.agentStream).not.toHaveBeenCalled();
  });

  it.each([true, false])("disables automatic attachment downloads with tools enabled=%s", async (toolCallingEnabled) => {
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig, toolCallingEnabled });
    await POST(request());
    const download = mocks.agentSettings[0]?.experimental_download as (urls: unknown[]) => Promise<unknown>;
    await expect(download([{ url: new URL("http://internal/image.png"), isUrlSupportedByModel: true }]))
      .rejects.toThrow("must provide file data instead");
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

  it("does not mutate chat when MCP preparation fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listEffectiveMcpServers.mockResolvedValue([{ id: "reference" }]);
    mocks.acquireMcpBinding.mockRejectedValue(
      new Error("MCP configuration failed"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
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

  it("reconstructs saved model context from persisted history", async () => {
    const storedMessages = [
      {
        id: "stored-user",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "Earlier question" }],
      },
      {
        id: "stored-assistant",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Earlier answer" }],
      },
    ];
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getMessages.mockResolvedValue(storedMessages);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.inlineUploads).toHaveBeenCalledWith(
      [...storedMessages, ...messages],
      "user",
    );
    expect(mocks.uiStreamOptions?.originalMessages).toEqual([
      ...storedMessages,
      ...messages,
    ]);
  });

  it("regenerates from an explicit saved assistant target", async () => {
    const storedUser = {
      id: "user-message",
      role: "user" as const,
      parts: [{ type: "text" as const, text: "Hello" }],
    };
    const storedAssistant = {
      id: "assistant-message",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Previous answer" }],
    };
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      action: {
        type: "regenerate",
        targetAssistantMessageId: "assistant-message",
      },
    });
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getMessages.mockResolvedValue([storedUser, storedAssistant]);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.inlineUploads).toHaveBeenCalledWith([storedUser], "user");
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        truncateFromMessageId: "assistant-message",
        userMessage: undefined,
      }),
    );
  });

  it("retries a committed user turn without inserting it twice", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      action: { type: "retry", userMessageId: "user-message" },
    });
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getMessages.mockResolvedValue(messages);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        truncateFromMessageId: undefined,
        userMessage: undefined,
      }),
    );
  });

  it("persists a retry when the first turn was never committed", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      action: { type: "retry", userMessageId: "user-message" },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        truncateFromMessageId: undefined,
        userMessage: { id: "user-message", parts: messages[0].parts },
      }),
    );
  });

  it("rejects a stale saved-history edit before model preparation", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      action: { type: "edit", targetUserMessageId: "missing-user-message" },
    });
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getMessages.mockResolvedValue([]);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("prepares an edit before atomically truncating and replacing it", async () => {
    const events: string[] = [];
    const editedMessage = {
      ...messages[0],
      id: "edited-user-message",
    };
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      messages: [editedMessage],
      action: { type: "edit", targetUserMessageId: "edited-user-message" },
    });
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getMessages.mockResolvedValue([
      {
        id: "edited-user-message",
        role: "user",
        parts: [{ type: "text", text: "Old" }],
      },
      {
        id: "old-assistant-message",
        role: "assistant",
        parts: [{ type: "text", text: "Old answer" }],
      },
    ]);
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
      return [editedMessage];
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
        userMessage: {
          id: "edited-user-message",
          parts: editedMessage.parts,
        },
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
    expect(mocks.failChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: claim.streamId,
      error: "stream setup failed",
    });
    consoleSpy.mockRestore();
  });

  it.each([true, false])(
    "notifies only when completion owns the saved stream (committed=%s)",
    async (committed) => {
      mocks.completeChatStream.mockReturnValue(committed);
      await POST(request());
      const onEnd = mocks.uiStreamOptions?.onEnd as (
        event: unknown,
      ) => Promise<void>;
      await onEnd({
        isAborted: false,
        responseMessage: {
          id: "answer",
          role: "assistant",
          parts: [{ type: "text", text: "Done" }],
        },
      });
      expect(mocks.notifyChatComplete).toHaveBeenCalledTimes(committed ? 1 : 0);
      if (committed)
        expect(
          mocks.completeChatStream.mock.invocationCallOrder[0],
        ).toBeLessThan(mocks.notifyChatComplete.mock.invocationCallOrder[0]);
    },
  );

  it.each(["pending", "rejected"])(
    "finishes saving and cleaning up the stream when push submission is %s",
    async (status) => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      let finishPush!: () => void;
      const push = new Promise<void>((resolve) => {
        finishPush = resolve;
      });
      mocks.notifyChatComplete.mockImplementationOnce(() =>
        status === "pending"
          ? push
          : Promise.reject(new Error("push unavailable")),
      );
      try {
        await POST(request());
        const claim = mocks.commitChatTurn.mock.calls[0][0];
        const onEnd = mocks.uiStreamOptions?.onEnd as (
          event: unknown,
        ) => Promise<void>;
        await onEnd({
          isAborted: false,
          responseMessage: {
            id: "answer",
            role: "assistant",
            parts: [{ type: "text", text: "Done" }],
          },
        });
        expect(mocks.completeChatStream).toHaveBeenCalledTimes(1);
        expect(mocks.notifyChatComplete).toHaveBeenCalledTimes(1);
        expect(mocks.cancelUnregister).toHaveBeenCalledWith(claim.streamId);
        expect(mocks.failChatStream).not.toHaveBeenCalled();
        if (status === "rejected")
          expect(consoleSpy).toHaveBeenCalledWith(
            "[push] Could not send chat notification.",
          );
      } finally {
        finishPush();
        consoleSpy.mockRestore();
      }
    },
  );

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
      status: "aborted",
    });
    expect(mocks.notifyChatComplete).not.toHaveBeenCalled();
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
      status: "error",
      error: "provider failed",
    });
    expect(mocks.notifyChatComplete).not.toHaveBeenCalled();
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
      status: "complete",
    });
  });

  it("consumes the response stream so abort cleanup runs without resumability", async () => {
    await POST(request());

    expect(mocks.getStreamContext).toHaveBeenCalledOnce();
    expect(mocks.responseOptions?.consumeSseStream).toBe(mocks.consumeStream);
    expect(mocks.consumeStream).toHaveBeenCalledWith({
      stream: mocks.responseStream,
    });
  });

  it("buffers a response-stream copy when resumability is enabled", async () => {
    const createNewResumableStream = vi.fn().mockResolvedValue(undefined);
    mocks.getStreamContext.mockReturnValue({ createNewResumableStream });

    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];

    expect(createNewResumableStream).toHaveBeenCalledWith(
      claim.streamId,
      expect.any(Function),
    );
    expect(createNewResumableStream.mock.calls[0][1]()).toBe(
      mocks.responseStream,
    );
    expect(mocks.consumeStream).not.toHaveBeenCalled();
  });

  it("registers the resumable stream before returning the response", async () => {
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const createNewResumableStream = vi.fn().mockReturnValue(ready);
    mocks.getStreamContext.mockReturnValue({ createNewResumableStream });

    let didReturn = false;
    const responsePromise = POST(request()).then((response) => {
      didReturn = true;
      return response;
    });

    await vi.waitFor(() => {
      expect(createNewResumableStream).toHaveBeenCalledOnce();
    });
    expect(didReturn).toBe(false);

    markReady();
    await expect(responsePromise).resolves.toHaveProperty("status", 200);
  });

  it("blocks a second request while the claimed stream is active", async () => {
    mocks.getChat.mockResolvedValue(existingChat("existing-stream"));
    mocks.cancelHas.mockReturnValue(true);

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("blocks a second request when another server owns the durable run", async () => {
    mocks.getChat.mockResolvedValue(existingChat("existing-stream"));
    mocks.getChatGeneration.mockResolvedValue({
      id: "existing-stream",
      chatId: "chat",
      userId: "user",
      clientRequestId: "other-client-request",
      requestFingerprint: "other-request-fingerprint",
      status: "running",
      error: null,
      responseMessageId: null,
      startedAt: new Date(),
      completedAt: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.cancelHas).toHaveBeenCalledWith("existing-stream");
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("reattaches an exact duplicate start without invoking the model", async () => {
    mocks.getChatGenerationByRequestId.mockResolvedValue({
      id: "existing-stream",
      chatId: "chat",
      userId: "user",
      clientRequestId: "client-request",
      requestFingerprint: "request-fingerprint",
      status: "running",
      error: null,
      responseMessageId: null,
      startedAt: new Date(),
      completedAt: null,
    });
    mocks.resumeChatStreamResponse.mockResolvedValue(
      new Response("resumed", { status: 200 }),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-OvertChat-Generation")).toBe("resumed");
    expect(mocks.resumeChatStreamResponse).toHaveBeenCalledWith(
      expect.any(Request),
      "existing-stream",
    );
    expect(mocks.getModelConfig).not.toHaveBeenCalled();
    expect(mocks.agentStream).not.toHaveBeenCalled();
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });

  it("never restarts a completed duplicate submission", async () => {
    mocks.getChatGenerationByRequestId.mockResolvedValue({
      id: "completed-stream",
      chatId: "chat",
      userId: "user",
      clientRequestId: "client-request",
      requestFingerprint: "request-fingerprint",
      status: "complete",
      error: null,
      responseMessageId: "assistant-message",
      startedAt: new Date(),
      completedAt: new Date(),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.text()).resolves.toBe(
      "Generation request was already completed",
    );
    expect(mocks.resumeChatStreamResponse).not.toHaveBeenCalled();
    expect(mocks.getModelConfig).not.toHaveBeenCalled();
    expect(mocks.agentStream).not.toHaveBeenCalled();
  });

  it("does not continue a voice chat through the text generation route", async () => {
    mocks.getChat.mockResolvedValue({ ...existingChat(), kind: "voice" });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
    expect(mocks.agentStream).not.toHaveBeenCalled();
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
            content: `${mocks.citationPrompt}\n\n${mocks.currentDatePrompt}`,
          },
          toolChoice: "auto",
          stopWhen: "stop-at-50",
        }),
      );
      expect(settings).not.toHaveProperty("runtimeContext");
      expect(settings).not.toHaveProperty("toolApproval");
    }
    expect(automatic.prepareStep).toEqual(expect.any(Function));
    const prepareStep = forced.prepareStep as (options: {
      stepNumber: number;
      messages: unknown[];
      steps: unknown[];
    }) => Promise<unknown>;
    expect(
      await prepareStep({
        stepNumber: 0,
        messages: convertedMessages,
        steps: [],
      }),
    ).toEqual({
      messages: convertedMessages,
      activeTools: mocks.toolOrder,
      toolChoice: "required",
    });
    expect(
      await prepareStep({
        stepNumber: 1,
        messages: convertedMessages,
        steps: [],
      }),
    ).toEqual({ messages: convertedMessages });
    expect(automatic.tools).toBe(forced.tools);
    expect(automatic.instructions).toEqual(forced.instructions);
    expect(mocks.currentDateSystemPrompt).toHaveBeenCalledWith(
      parsedRequest.timeZone,
    );
    expect(mocks.toUIMessageStream.mock.calls[0][0].tools).toBe(
      mocks.chatTools,
    );
    expect(mocks.toUIMessageStream.mock.calls[1][0].tools).toBe(
      mocks.chatTools,
    );
    expect(mocks.createWebTools).toHaveBeenCalledWith({
      userId: "user",
      supportsImageInput: true,
    });
    expect(mocks.convertToModelMessages).toHaveBeenCalledWith(messages, {
      tools: mocks.chatTools,
      ignoreIncompleteToolCalls: true,
    });
  });

  it("marks fetched images unavailable to an explicitly text-only model", async () => {
    mocks.resolveModelCapabilities.mockReturnValue({
      inputModalities: ["text"],
    });

    await POST(request());

    expect(mocks.createWebTools).toHaveBeenCalledWith({
      userId: "user",
      supportsImageInput: false,
    });
    expect(mocks.createConfiguredLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({ supportsImageInput: false }),
    );
  });

  it("forwards a discovered reasoning level to a local runtime", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      reasoningLevel: "low",
    });
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      providerId: "llamacpp",
      apiFormat: "auto",
    });
    mocks.resolveModelCapabilities.mockReturnValue({
      reasoningControls: {
        toggle: true,
        defaultLevel: "low",
        efforts: ["low"],
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createConfiguredLanguageModel).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "llamacpp",
        reasoningLevel: "low",
      }),
    );
  });

  it("rejects reasoning levels absent from discovered controls", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      reasoningLevel: "low",
    });
    mocks.resolveModelCapabilities.mockReturnValue({
      reasoningControls: {
        toggle: true,
        defaultLevel: "medium",
        efforts: ["medium"],
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Reasoning level low is unavailable for this model",
    );
    expect(mocks.createConfiguredLanguageModel).not.toHaveBeenCalled();
  });

  it("removes web tools when the capability is disabled", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      webSearchEnabled: false,
      forceSearch: true,
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        model: "language-model",
        instructions: {
          role: "system",
          content: mocks.currentDatePrompt,
        },
      }),
    );
    expect(mocks.agentSettings[0]).not.toHaveProperty("tools");
    expect(mocks.agentSettings[0]).not.toHaveProperty("toolOrder");
    expect(mocks.agentSettings[0]).not.toHaveProperty("toolChoice");
    expect(mocks.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: undefined }),
    );
  });

  it("forwards llama.cpp prompt progress as transient UI data", async () => {
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      providerId: "llamacpp",
      apiFormat: "auto",
    });
    mocks.getProvider.mockReturnValue({ label: "llama.cpp", iconId: null });
    mocks.agentStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "raw",
            rawValue: {
              choices: [{ delta: { content: null }, finish_reason: null }],
              prompt_progress: {
                total: 2_048,
                cache: 0,
                processed: 1_536,
                time_ms: 3_200,
              },
            },
          });
          controller.close();
        },
      }),
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toMatchObject({
      include: { rawChunks: true },
    });
    expect(mocks.outerUiStreamOptions).toBeDefined();
    expect(mocks.mergedUiStream).toBeDefined();

    const observed = mocks.uiStreamOptions?.stream as ReadableStream<unknown>;
    await observed.pipeTo(new WritableStream());

    expect(mocks.uiChunks).toEqual([
      {
        type: "data-inference-activity",
        transient: true,
        data: {
          phase: "prompt",
          completedTokens: 1_536,
          totalTokens: 2_048,
          cachedTokens: 0,
          elapsedMs: 3_200,
          progress: 0.75,
          tokensPerSecond: 480,
        },
      },
    ]);
  });

  it("uses persistent MCP tools without web tools", async () => {
    const mcpTool = { description: "MCP echo" };
    const mcpTools = {
      mcp__reference__abc1234__echo__def12: mcpTool,
    };
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      webSearchEnabled: false,
      forceSearch: true,
    });
    mocks.listEffectiveMcpServers.mockResolvedValue([{ id: "reference" }]);
    mocks.acquireMcpBinding.mockResolvedValue({
      tools: mcpTools,
      release: mocks.releaseMcpBinding,
    });
    mocks.agentStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        tools: mcpTools,
        toolOrder: Object.keys(mcpTools),
        toolChoice: "auto",
      }),
    );
    expect(mocks.agentSettings[0]?.prepareStep).toEqual(expect.any(Function));
    expect(mocks.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mcpTools }),
    );
    expect(mocks.acquireMcpBinding).toHaveBeenCalledWith(
      { userId: "user", chatId: "chat" },
      [{ id: "reference" }],
    );
    const observed = mocks.uiStreamOptions?.stream as
      ReadableStream<unknown> | undefined;
    await observed?.pipeTo(new WritableStream());
    expect(mocks.releaseMcpBinding).toHaveBeenCalledOnce();
  });

  it("releases an MCP binding when the atomic chat claim fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listEffectiveMcpServers.mockResolvedValue([{ id: "reference" }]);
    mocks.commitChatTurn.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseMcpBinding).toHaveBeenCalledOnce();
    expect(mocks.agentStream).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("labels project context between model and web instructions", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      projectId: "project",
    });
    mocks.getProject.mockResolvedValue({
      id: "project",
      name: "Research",
      instructions: "project instructions",
    });
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      systemPrompt: "model instructions",
    });

    await POST(request());

    expect(mocks.agentSettings[0].instructions).toEqual({
      role: "system",
      content: [
        "model instructions",
        [
          "Project context:",
          'You are working in a project named "Research".',
          "",
          "User-provided project instructions:",
          "project instructions",
        ].join("\n"),
        mocks.citationPrompt,
        mocks.currentDatePrompt,
      ].join("\n\n"),
    });
  });

  it("injects populated personalization and registers memory tools", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      webSearchEnabled: false,
    });
    mocks.getActivePersonalization.mockResolvedValue({
      personalization: {
        enabled: true,
        preferredName: "Boomer",
        occupation: "Engineer",
        about: null,
      },
      memories: [
        {
          id: "memory",
          key: "response_style",
          value: "Prefer concise answers.",
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        tools: mocks.memoryTools,
        toolOrder: mocks.memoryToolOrder,
        instructions: {
          role: "system",
          content: [
            "# User profile\nPreferred name: Boomer\nOccupation: Engineer",
            "# Existing memory about the user\n- `response_style`: Prefer concise answers.",
            mocks.currentDatePrompt,
          ].join("\n\n"),
        },
      }),
    );
    expect(mocks.createMemoryTools).toHaveBeenCalledWith("user");
  });

  it("omits empty personalization context while leaving memory tools available", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      webSearchEnabled: false,
    });
    mocks.getActivePersonalization.mockResolvedValue({
      personalization: {
        enabled: true,
        preferredName: null,
        occupation: null,
        about: null,
      },
      memories: [],
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        tools: mocks.memoryTools,
        instructions: {
          role: "system",
          content: mocks.currentDatePrompt,
        },
      }),
    );
  });

  it("does not load or expose personalization in temporary chats", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      temporary: true,
      webSearchEnabled: false,
    });

    await POST(request());

    expect(mocks.getActivePersonalization).not.toHaveBeenCalled();
    expect(mocks.createMemoryTools).not.toHaveBeenCalled();
    expect(mocks.agentSettings[0]).not.toHaveProperty("tools");
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
          content: `${mocks.citationPrompt}\n\n${mocks.currentDatePrompt}`,
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
      content: `${mocks.citationPrompt}\n\n${mocks.currentDatePrompt}`,
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
        instructions: {
          role: "system",
          content: mocks.currentDatePrompt,
        },
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
    expect(mocks.ensureChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        fallbackModelConfig: modelConfig,
      }),
    );
    expect(messages).toEqual(originalMessages);
    expect(mocks.agentSettings[0]).not.toHaveProperty("runtimeContext");
  });

  it.each([false, true])(
    "compacts regular chat and carries checkpoints in response metadata (temporary=%s)",
    async (temporary) => {
      const old = {
        id: "old-user",
        role: "user" as const,
        parts: [
          {
            type: "text" as const,
            text: "Remember ORCHID-47. " + "reference ".repeat(10000),
          },
        ],
      };
      const history = [old, ...messages];
      const modelHistory = history.map((message) => ({
        role: message.role,
        content: message.parts[0].text,
      }));
      mocks.parseChatRequest.mockResolvedValue({
        ...parsedRequest,
        messages: history,
        temporary,
      });
      mocks.inlineUploads.mockResolvedValue(history);
      mocks.convertToModelMessages.mockResolvedValue(modelHistory);
      mocks.resolveModelContextWindow.mockReturnValue(4096);
      mocks.generateText.mockResolvedValue({
        text: "The launch code is ORCHID-47.",
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
          inputTokenDetails: {},
        },
      });
      await POST(request());
      const prepare = mocks.agentSettings[0].prepareStep as (
        input: object,
      ) => Promise<{ messages: Array<{ content: string }> }>;
      const prepared = await prepare({
        messages: modelHistory,
        steps: [],
        stepNumber: 0,
      });
      expect(prepared.messages[0].content).toContain("ORCHID-47");
      expect(prepared.messages.at(-1)?.content).toBe("Hello");
      expect(mocks.agentSettings[0].maxOutputTokens).toBe(1024);
      expect(mocks.uiStreamOptions?.originalMessages).toEqual(history);
      expect(mocks.uiChunks).toContainEqual({
        type: "data-context-status",
        data: "compacted",
        transient: true,
      });
      const metadata = (
        mocks.uiStreamOptions?.messageMetadata as (
          input: object,
        ) => Record<string, unknown>
      )({
        part: {
          type: "finish",
          finishReason: "stop",
          totalUsage: {
            inputTokens: 200,
            outputTokens: 20,
            totalTokens: 220,
            inputTokenDetails: {},
          },
        },
      });
      expect(metadata.contextCheckpoint).toMatchObject({
        boundaryMessageId: "user-message",
        summary: expect.stringContaining("ORCHID-47"),
      });
      await (mocks.uiStreamOptions?.onEnd as (input: object) => Promise<void>)({
        responseMessage: {
          id: "response",
          role: "assistant",
          parts: [{ type: "text", text: "Answer" }],
          metadata,
        },
        isAborted: false,
      });
      if (temporary) {
        expect(mocks.commitChatTurn).not.toHaveBeenCalled();
        expect(mocks.completeChatStream).not.toHaveBeenCalled();
      } else {
        expect(mocks.completeChatStream).toHaveBeenCalledWith(
          expect.objectContaining({
            assistantMessage: expect.objectContaining({ metadata }),
            usage: expect.objectContaining({
              inputTokens: 200 + 100 * mocks.generateText.mock.calls.length,
            }),
          }),
        );
      }
    },
  );

  it.each([false, true])(
    "runs compact-only through the owned stream without generating an answer (temporary=%s)",
    async (temporary) => {
      const history = [
        {
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "Remember ORCHID-47" }],
        },
        {
          id: "a1",
          role: "assistant",
          parts: [{ type: "text", text: "Okay" }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "Continue" }] },
        {
          id: "a2",
          role: "assistant",
          parts: [{ type: "text", text: "Ready" }],
        },
      ];
      mocks.parseChatRequest.mockResolvedValue({
        ...parsedRequest,
        action: { type: "compact" },
        messages: temporary ? history : history.slice(-1),
        temporary,
      });
      mocks.getChat.mockResolvedValue(
        temporary ? null : { id: "chat", title: "Saved chat" },
      );
      mocks.getMessages.mockResolvedValue(history);
      mocks.inlineUploads.mockResolvedValue(history);
      mocks.convertToModelMessages.mockResolvedValue(
        history.map((m) => ({ role: m.role, content: m.parts[0].text })),
      );
      mocks.generateText.mockResolvedValue({
        text: "The code is ORCHID-47",
        usage: {
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
          inputTokenDetails: {},
        },
      });
      expect((await POST(request())).status).toBe(200);
      const reader = (
        mocks.uiStreamOptions!.stream as ReadableStream<Record<string, unknown>>
      ).getReader();
      const parts: Record<string, unknown>[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        parts.push(next.value);
      }
      expect(parts.map((p) => p.type)).toEqual(["start", "finish"]);
      expect(mocks.agentStream).not.toHaveBeenCalled();
      expect(mocks.uiStreamOptions?.originalMessages).toBeUndefined();
      const metadata = (
        mocks.uiStreamOptions!.messageMetadata as (
          input: object,
        ) => Record<string, unknown>
      )({ part: parts.at(-1) });
      expect(metadata).toMatchObject({
        contextStatus: "manual-compacted",
        contextCheckpoint: {
          boundaryMessageId: "u2",
          summary: "The code is ORCHID-47",
        },
      });
      await (mocks.uiStreamOptions!.onEnd as (input: object) => Promise<void>)({
        responseMessage: {
          id: "marker",
          role: "assistant",
          parts: [],
          metadata,
        },
        isAborted: false,
      });
      if (temporary) {
        expect(mocks.commitChatTurn).not.toHaveBeenCalled();
        expect(mocks.completeChatStream).not.toHaveBeenCalled();
      } else {
        expect(mocks.commitChatTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            userMessage: undefined,
            truncateFromMessageId: undefined,
          }),
        );
        expect(mocks.completeChatStream).toHaveBeenCalledWith(
          expect.objectContaining({
            assistantMessage: { id: "marker", parts: [], metadata },
            usage: expect.objectContaining({
              inputTokens: 100,
              outputTokens: 10,
            }),
          }),
        );
      }
      expect(mocks.notifyChatComplete).not.toHaveBeenCalled();
    },
  );

  it("does not save a replacement checkpoint or answer after a failed manual summary", async () => {
    const history = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Important old fact" }],
      },
      {
        id: "u2",
        role: "user",
        parts: [{ type: "text", text: "Current request" }],
      },
    ];
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      action: { type: "compact" },
      messages: history.slice(-1),
    });
    mocks.getChat.mockResolvedValue({ id: "chat", title: "Saved" });
    mocks.getMessages.mockResolvedValue(history);
    mocks.inlineUploads.mockResolvedValue(history);
    mocks.convertToModelMessages.mockResolvedValue(
      history.map((m) => ({ role: m.role, content: m.parts[0].text })),
    );
    mocks.generateText.mockRejectedValue(new Error("Summarizer unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await POST(request());
      const reader = (
        mocks.uiStreamOptions!.stream as ReadableStream<Record<string, unknown>>
      ).getReader();
      const parts: Record<string, unknown>[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        parts.push(next.value);
      }
      expect(parts.map((p) => p.type)).toEqual(["start", "error"]);
      expect((parts[1].error as Error).message).toContain(
        "previous checkpoint are unchanged",
      );
      await (mocks.uiStreamOptions!.onEnd as (input: object) => Promise<void>)({
        responseMessage: {
          id: "marker",
          role: "assistant",
          parts: [],
          metadata: { contextStatus: "manual-compacting" },
        },
        isAborted: false,
      });
      expect(mocks.completeChatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantMessage: undefined,
          status: "error",
        }),
      );
      expect(mocks.agentStream).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("requests an explicit context window for unknown models before claiming a stream", async () => {
    mocks.resolveModelContextWindow.mockReturnValue(undefined);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("context window");
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
    expect(mocks.agentStream).not.toHaveBeenCalled();
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
        contextTokens: 110,
        contextWindow: 128_000,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        uncachedInputTokens: 15,
        responseTokens: 10,
        totalTokens: 110,
        finishReason: "stop",
      }),
    });
  });

  it("records reported generation usage with the saved assistant", async () => {
    await POST(request());
    const messageMetadata = mocks.uiStreamOptions?.messageMetadata as (event: {
      part: Record<string, unknown>;
    }) => unknown;
    const onEnd = mocks.uiStreamOptions?.onEnd as (event: {
      responseMessage: {
        id: string;
        parts: Array<{ type: string; text: string }>;
      };
    }) => Promise<void>;

    messageMetadata({
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
    await onEnd({
      responseMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Hello" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: expect.any(String),
      assistantMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Hello" }],
      },
      status: "complete",
      usage: {
        occurredAt: expect.any(Date),
        providerId: "custom",
        model: "test-model",
        inputTokens: 100,
        uncachedInputTokens: 15,
        outputTokens: 10,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        totalTokens: 110,
        finishReason: "stop",
      },
    });
  });

  it("records configured model pricing with chat usage", async () => {
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      pricing: {
        input: 2,
        output: 8,
        cacheRead: 0.2,
        cacheWrite: 2.5,
      },
    });

    await POST(request());
    const messageMetadata = mocks.uiStreamOptions?.messageMetadata as (event: {
      part: Record<string, unknown>;
    }) => unknown;
    const onEnd = mocks.uiStreamOptions?.onEnd as (event: {
      responseMessage: {
        id: string;
        parts: Array<{ type: string; text: string }>;
      };
    }) => Promise<void>;

    messageMetadata({
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
    await onEnd({
      responseMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Hello" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          costSource: "model_config",
          inputCostNanoUsd: 30_000,
          outputCostNanoUsd: 80_000,
          cacheReadCostNanoUsd: 16_000,
          cacheWriteCostNanoUsd: 12_500,
          totalCostNanoUsd: 138_500,
        }),
      }),
    );
  });

  it("uses latest-step context and prices each tool-loop request tier", async () => {
    mocks.getModelConfig.mockResolvedValue({
      ...modelConfig,
      providerId: "openai",
      apiFormat: "auto",
      model: "tiered-model",
    });
    mocks.catalogEntryFor.mockReturnValue({
      cost: {
        input: 1,
        output: 2,
        tiers: [
          {
            input: 10,
            output: 20,
            tier: { type: "context", size: 150 },
          },
        ],
      },
    });
    mocks.catalogPricingFor.mockReturnValue({
      input: 1,
      output: 2,
      cacheRead: 1,
      cacheWrite: 1,
      tiered: true,
    });
    mocks.agentStream.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "finish-step",
            usage: {
              inputTokens: 100,
              inputTokenDetails: {
                noCacheTokens: 100,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokens: 20,
            },
          });
          controller.enqueue({
            type: "finish-step",
            usage: {
              inputTokens: 160,
              inputTokenDetails: {
                noCacheTokens: 160,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
              outputTokens: 30,
            },
          });
          controller.close();
        },
      }),
    });

    await POST(request());

    const observed = mocks.uiStreamOptions
      ?.stream as ReadableStream<Record<string, unknown>>;
    const reader = observed.getReader();
    while (!(await reader.read()).done) {
      // Consume the observed stream so finish-step callbacks run.
    }

    const messageMetadata = mocks.uiStreamOptions?.messageMetadata as (event: {
      part: Record<string, unknown>;
    }) => { stats: MessageStats };
    const metadata = messageMetadata({
      part: {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 260,
          inputTokenDetails: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            noCacheTokens: 260,
          },
          outputTokens: 50,
          totalTokens: 310,
        },
      },
    });

    expect(metadata.stats).toMatchObject({
      contextTokens: 190,
      responseTokens: 50,
      totalTokens: 310,
    });

    const onEnd = mocks.uiStreamOptions?.onEnd as (event: {
      responseMessage: {
        id: string;
        parts: Array<{ type: string; text: string }>;
      };
    }) => Promise<void>;
    await onEnd({
      responseMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Done" }],
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({
          costSource: "models.dev",
          inputCostNanoUsd: 1_700_000,
          outputCostNanoUsd: 640_000,
          totalCostNanoUsd: 2_340_000,
        }),
      }),
    );
  });

  it("persists assistant message metadata at stream completion", async () => {
    await POST(request());
    const onEnd = mocks.uiStreamOptions?.onEnd as (event: {
      responseMessage: {
        id: string;
        parts: Array<{ type: string; text: string }>;
        metadata?: Record<string, unknown>;
      };
    }) => Promise<void>;

    await onEnd({
      responseMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Hello" }],
        metadata: { stats: { contextTokens: 110, contextWindow: 128_000 } },
      },
    });

    expect(mocks.completeChatStream).toHaveBeenCalledWith({
      chatId: "chat",
      streamId: expect.any(String),
      assistantMessage: {
        id: "assistant-message",
        parts: [{ type: "text", text: "Hello" }],
        metadata: {
          stats: { contextTokens: 110, contextWindow: 128_000 },
        },
      },
      status: "complete",
    });
  });
  it.each([false, true])("leaves image sequencing automatic and respects explicit search (%s)", async (forceSearch) => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      forceSearch,
      imageGeneration: { size: "auto", quality: "auto" },
    });
    mocks.getImageCapability.mockReturnValue({ available: true, model: "image-model" });
    const imageTools = {
      generate_image: { description: "Generate image" },
      edit_image: { description: "Edit image" },
    };
    mocks.createImageTools.mockReturnValue(imageTools);

    await POST(request());

      const settings = mocks.agentSettings[0];
      expect(settings.tools).toMatchObject({
        ...mocks.chatTools,
        ...imageTools,
      });
      expect(settings.toolChoice).toBe("auto");
      expect(settings.instructions).toMatchObject({
        content: expect.stringContaining(
          "The user selected Create image for this turn.",
        ),
      });
      if (forceSearch) {
        const prepareStep = settings.prepareStep as (options: {
          stepNumber: number;
          messages: unknown[];
          steps: unknown[];
        }) => Promise<unknown>;
        expect(
          await prepareStep({
            stepNumber: 0,
            messages: convertedMessages,
            steps: [],
          }),
        ).toEqual({
          messages: convertedMessages,
          activeTools: mocks.toolOrder,
          toolChoice: "required",
        });
        expect(
          await prepareStep({
            stepNumber: 1,
            messages: convertedMessages,
            steps: [],
          }),
        ).toEqual({ messages: convertedMessages });
      } else {
        expect(settings.prepareStep).toEqual(expect.any(Function));
      }
    },
  );

  it("rejects explicit image requests before persistence when unavailable", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.parseChatRequest.mockResolvedValue({ ...parsedRequest, imageGeneration: { size: "auto", quality: "auto" } });
    mocks.getChatGenerationByRequestId.mockResolvedValue(null);
    mocks.getChat.mockResolvedValue(null);
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig });
    mocks.getImageCapability.mockReturnValue({ available: false, model: null });
    mocks.commitChatTurn.mockClear();
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.commitChatTurn).not.toHaveBeenCalled();
  });
  it.each([true, false])("registers image tools according to chat tool calling (%s)", async (enabled) => {
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig, toolCallingEnabled: enabled });
    mocks.getImageCapability.mockReturnValue({ available: true, model: "gpt-image-1" });
    const generate = { description: "Generate image" };
    const edit = { description: "Edit image" };
    mocks.createImageTools.mockReturnValue({ generate_image: generate, edit_image: edit });
    await POST(request());
    if (enabled) {
      expect(mocks.agentSettings[0].tools).toMatchObject({ generate_image: generate, edit_image: edit });
    } else {
      expect(mocks.agentSettings[0]).not.toHaveProperty("tools");
    }
  });

});
