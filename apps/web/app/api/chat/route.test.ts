import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageStats } from "@/lib/chat/stats";

const mocks = vi.hoisted(() => {
  const webTools = {
    web_search: { description: "search" },
    fetch_url: { description: "fetch" },
  };
  const chatTools = { ...webTools };
  const codeExecutionTools = {
    execute_code: { description: "python" },
  };

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
    getTaskModelConfig: vi.fn(),
    getServerCapability: vi.fn(),
    listEffectiveMcpServers: vi.fn(),
    acquireMcpBinding: vi.fn(),
    releaseMcpBinding: vi.fn(),
    getProject: vi.fn(),
    generateChatTitle: vi.fn(),
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
    currentDateSystemPrompt: vi.fn(),
    convertToModelMessages: vi.fn(),
    createWebTools: vi.fn(),
    createCodeExecutionTools: vi.fn(),
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
    codeExecutionTools,
    toolOrder: ["execute_code", "web_search", "fetch_url"],
    webToolNames: ["web_search", "fetch_url"],
    citationPrompt: "stable web citation instruction",
    currentDatePrompt: "Current date: 2026-07-22.",
  };
});

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
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
vi.mock("@/lib/tools", () => ({
  createWebTools: mocks.createWebTools,
  createCodeExecutionTools: mocks.createCodeExecutionTools,
  CHAT_TOOL_ORDER: mocks.toolOrder,
  WEB_TOOL_NAMES: mocks.webToolNames,
  WEB_SEARCH_CITATION_PROMPT: mocks.citationPrompt,
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
  getTaskModelConfig: mocks.getTaskModelConfig,
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
  webSearchEnabled: true,
  codeExecutionSupported: false,
  forceSearch: false,
  timeZone: "America/Los_Angeles",
  projectId: null,
  trigger: "submit-message" as const,
  messageId: undefined,
  temporary: false,
  toolContinuation: false,
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
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig });
    mocks.getTaskModelConfig.mockReturnValue(null);
    mocks.getServerCapability.mockReturnValue({ provider: "bundled" });
    mocks.listEffectiveMcpServers.mockResolvedValue([]);
    mocks.releaseMcpBinding.mockResolvedValue(undefined);
    mocks.acquireMcpBinding.mockResolvedValue({
      tools: {},
      release: mocks.releaseMcpBinding,
    });
    mocks.getChat.mockResolvedValue(null);
    mocks.getProject.mockResolvedValue(null);
    mocks.getChatMessage.mockResolvedValue(null);
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "language-model",
      providerOptions: undefined,
      promptCacheStrategy: undefined,
    });
    mocks.resolveModelCapabilities.mockReturnValue(undefined);
    mocks.createWebTools.mockReturnValue(mocks.chatTools);
    mocks.createCodeExecutionTools.mockReturnValue(mocks.codeExecutionTools);
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
    mocks.clearActiveStreamId.mockResolvedValue(undefined);
    mocks.generateChatTitle.mockResolvedValue(null);
    mocks.getStreamContext.mockReturnValue(null);
    mocks.currentDateSystemPrompt.mockReturnValue(mocks.currentDatePrompt);
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

    expect(createNewResumableStream).toHaveBeenCalledWith(
      claim.streamId,
      expect.any(Function),
    );
    expect(createNewResumableStream.mock.calls[0][1]()).toBe(
      mocks.responseStream,
    );
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
          toolOrder: mocks.webToolNames,
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
    expect(automatic.prepareStep).toBeUndefined();
    const prepareStep = forced.prepareStep as (options: {
      stepNumber: number;
    }) => unknown;
    expect(prepareStep({ stepNumber: 0 })).toEqual({
      activeTools: mocks.webToolNames,
      toolChoice: "required",
    });
    expect(prepareStep({ stepNumber: 1 })).toBeUndefined();
    expect(automatic.tools).toEqual(forced.tools);
    expect(automatic.instructions).toEqual(forced.instructions);
    expect(mocks.currentDateSystemPrompt).toHaveBeenCalledWith(
      parsedRequest.timeZone,
    );
    expect(mocks.toUIMessageStream.mock.calls[0][0].tools).toEqual(
      mocks.chatTools,
    );
    expect(mocks.toUIMessageStream.mock.calls[1][0].tools).toEqual(
      mocks.chatTools,
    );
    expect(mocks.createWebTools).toHaveBeenCalledWith({
      userId: "user",
      supportsImageInput: true,
    });
    expect(mocks.convertToModelMessages).toHaveBeenCalledWith(messages, {
      tools: { ...mocks.chatTools, ...mocks.codeExecutionTools },
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

  it("exposes browser code execution only when the client advertises support", async () => {
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      webSearchEnabled: false,
      codeExecutionSupported: true,
    });

    await POST(request());

    expect(mocks.agentSettings[0]).toEqual(
      expect.objectContaining({
        tools: mocks.codeExecutionTools,
        toolOrder: ["execute_code"],
        toolChoice: "auto",
      }),
    );
    expect(mocks.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mocks.codeExecutionTools }),
    );
    expect(mocks.agentSettings[0].instructions).toEqual({
      role: "system",
      content: expect.stringContaining(
        "Files attached in this conversation and files generated by earlier Python calls are mounted by filename under /mnt/uploads.",
      ),
    });
  });

  it("claims an automatic code continuation without inserting or truncating a turn", async () => {
    const assistant = {
      id: "assistant-message",
      role: "assistant" as const,
      parts: [
        {
          type: "tool-execute_code" as const,
          toolCallId: "call-1",
          state: "output-available" as const,
          input: { language: "python", code: "1 + 1" },
          output: {
            stdout: null,
            stderr: null,
            result: 2,
            outputs: [],
          },
        },
      ],
    };
    const continuationMessages = [...messages, assistant];
    mocks.parseChatRequest.mockResolvedValue({
      ...parsedRequest,
      messages: continuationMessages,
      codeExecutionSupported: true,
      toolContinuation: true,
      messageId: assistant.id,
    });
    mocks.inlineUploads.mockResolvedValue(continuationMessages);
    mocks.getChat.mockResolvedValue(existingChat());
    mocks.getChatMessage.mockResolvedValue(assistant);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.getChatMessage).toHaveBeenCalledWith("chat", assistant.id);
    expect(mocks.commitChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        truncateFromMessageId: undefined,
        userMessage: undefined,
        assistantContinuation: {
          id: assistant.id,
          parts: assistant.parts,
        },
      }),
    );
    expect(mocks.generateChatTitle).not.toHaveBeenCalled();
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
    expect(mocks.agentSettings[0]?.prepareStep).toBeUndefined();
    expect(mocks.toUIMessageStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: mcpTools }),
    );
    expect(mocks.acquireMcpBinding).toHaveBeenCalledWith(
      { userId: "user", chatId: "chat" },
      [{ id: "reference" }],
    );
    const observed = mocks.uiStreamOptions?.stream as
      | ReadableStream<unknown>
      | undefined;
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
    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user",
        modelConfig,
        userParts: messages[0].parts,
      }),
    );
    expect(messages).toEqual(originalMessages);
    expect(mocks.agentSettings[0]).not.toHaveProperty("runtimeContext");
  });

  it("uses a dedicated task model for title generation even when hidden from chat", async () => {
    const taskModelConfig = {
      ...modelConfig,
      id: "task-model",
      label: "Fast task model",
      model: "fast-model",
      enabled: false,
      taskModel: true,
    };
    mocks.getTaskModelConfig.mockReturnValue(taskModelConfig);

    await POST(request());

    expect(mocks.getTaskModelConfig).toHaveBeenCalledOnce();
    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      expect.objectContaining({ modelConfig: taskModelConfig }),
    );
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
    });
  });
});
