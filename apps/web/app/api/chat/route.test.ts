import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  buildRuntimeContext: vi.fn(),
  cancelRegister: vi.fn(),
  cancelUnregister: vi.fn(),
  cancelHas: vi.fn(),
  getStreamContext: vi.fn(),
  convertToModelMessages: vi.fn(),
  streamText: vi.fn(),
  stepCountIs: vi.fn(),
  streamOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({
  convertToModelMessages: mocks.convertToModelMessages,
  streamText: mocks.streamText,
  stepCountIs: mocks.stepCountIs,
}));
vi.mock("@/lib/tools", () => ({
  webTools: {},
  WEB_SEARCH_CITATION_PROMPT: "cite sources",
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
vi.mock("@/lib/runtime-context", () => ({
  buildRuntimeContext: mocks.buildRuntimeContext,
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

const parsedRequest = {
  messages,
  modelConfigId: "model-config",
  chatId: "chat",
  searchEnabled: false,
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
    mocks.streamOptions = undefined;
    mocks.getSession.mockResolvedValue({ user: { id: "user" } });
    mocks.parseChatRequest.mockResolvedValue({ ...parsedRequest });
    mocks.getModelConfig.mockResolvedValue({ ...modelConfig });
    mocks.getChat.mockResolvedValue(null);
    mocks.getProject.mockResolvedValue(null);
    mocks.getChatMessage.mockResolvedValue(null);
    mocks.createConfiguredLanguageModel.mockReturnValue({
      model: "language-model",
      providerOptions: undefined,
    });
    mocks.inlineUploads.mockResolvedValue(messages);
    mocks.convertToModelMessages.mockResolvedValue([
      { role: "user", content: "Hello" },
    ]);
    mocks.getProvider.mockReturnValue({
      label: "Custom",
      iconId: null,
    });
    mocks.modelIconForModel.mockReturnValue(null);
    mocks.buildRuntimeContext.mockReturnValue("runtime context");
    mocks.cancelHas.mockReturnValue(false);
    mocks.commitChatTurn.mockReturnValue("committed");
    mocks.completeChatStream.mockReturnValue(true);
    mocks.clearActiveStreamId.mockResolvedValue(undefined);
    mocks.generateChatTitle.mockResolvedValue(null);
    mocks.getStreamContext.mockReturnValue(null);
    mocks.streamText.mockImplementation(() => ({
      toUIMessageStreamResponse: (options: Record<string, unknown>) => {
        mocks.streamOptions = options;
        return new Response("stream", {
          status: 200,
          headers: options.headers as Headers,
        });
      },
    }));
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
      return { model: "language-model", providerOptions: undefined };
    });
    mocks.inlineUploads.mockImplementation(async () => {
      events.push("uploads");
      return messages;
    });
    mocks.convertToModelMessages.mockImplementation(async () => {
      events.push("convert");
      return [{ role: "user", content: "Hello" }];
    });
    mocks.cancelRegister.mockImplementation(() => events.push("register"));
    mocks.commitChatTurn.mockImplementation(() => {
      events.push("commit");
      return "committed";
    });
    mocks.streamText.mockImplementation(() => {
      events.push("stream");
      return {
        toUIMessageStreamResponse: (options: Record<string, unknown>) => {
          mocks.streamOptions = options;
          return new Response("stream", {
            headers: options.headers as Headers,
          });
        },
      };
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
    expect(mocks.streamText).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("cleans the controller and active claim when stream setup throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.streamText.mockImplementation(() => {
      throw new Error("stream setup failed");
    });

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
    const onFinish = mocks.streamOptions?.onFinish as (
      event: unknown,
    ) => Promise<void>;

    await onFinish({
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
    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const streamConfig = mocks.streamText.mock.calls[0][0] as {
      onError: (event: { error: unknown }) => void;
    };
    const onFinish = mocks.streamOptions?.onFinish as (
      event: unknown,
    ) => Promise<void>;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    streamConfig.onError({ error: new Error("provider failed") });
    await onFinish({
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

  it("does not tee the response stream when resumability is disabled", async () => {
    await POST(request());

    expect(mocks.getStreamContext).toHaveBeenCalledOnce();
    expect(mocks.streamOptions?.consumeSseStream).toBeUndefined();
  });

  it("buffers a response-stream copy when resumability is enabled", async () => {
    const createNewResumableStream = vi.fn().mockResolvedValue(undefined);
    mocks.getStreamContext.mockReturnValue({ createNewResumableStream });

    await POST(request());
    const claim = mocks.commitChatTurn.mock.calls[0][0];
    const consumeSseStream = mocks.streamOptions?.consumeSseStream as (event: {
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
});
