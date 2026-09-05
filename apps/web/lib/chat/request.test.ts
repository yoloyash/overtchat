import { describe, expect, it } from "vitest";
import {
  chatRequestFingerprint,
  ChatRequestError,
  parseChatRequest,
} from "./request";

function request(body: unknown): Request {
  return new Request("http://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  modelConfigId: "model-config",
  chatId: "chat",
  timeZone: "America/Los_Angeles",
  messages: [
    {
      id: "user-message",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    },
  ],
};

describe("chat request parsing", () => {
  it("validates and normalizes an explicit submit request", async () => {
    await expect(
      parseChatRequest(
        request({ ...validBody, action: { type: "submit" } }),
      ),
    ).resolves.toMatchObject({
      ...validBody,
      webSearchEnabled: true,
      forceSearch: false,
      temporary: false,
      action: { type: "submit" },
      reasoningLevel: "default",
    });
  });

  it("accepts supported reasoning levels and rejects unknown values", async () => {
    await expect(
      parseChatRequest(request({ ...validBody, reasoningLevel: "xhigh" })),
    ).resolves.toMatchObject({ reasoningLevel: "xhigh" });
    await expect(
      parseChatRequest(request({ ...validBody, reasoningLevel: "ultra" })),
    ).rejects.toBeInstanceOf(ChatRequestError);
  });

  it("preserves a submission receipt and creates one for legacy clients", async () => {
    await expect(
      parseChatRequest(
        request({ ...validBody, clientRequestId: "request-one" }),
      ),
    ).resolves.toMatchObject({ clientRequestId: "request-one" });

    const legacy = await parseChatRequest(request(validBody));
    expect(legacy.clientRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it("fingerprints the intent independently of its retry receipt", async () => {
    const first = await parseChatRequest(
      request({ ...validBody, clientRequestId: "request-one" }),
    );
    const retry = await parseChatRequest(
      request({ ...validBody, clientRequestId: "request-two" }),
    );
    const changed = await parseChatRequest(
      request({
        ...validBody,
        clientRequestId: "request-one",
        forceSearch: true,
      }),
    );
    const changedReasoning = await parseChatRequest(
      request({
        ...validBody,
        clientRequestId: "request-one",
        reasoningLevel: "low",
      }),
    );

    expect(chatRequestFingerprint(first)).toBe(chatRequestFingerprint(retry));
    expect(chatRequestFingerprint(changed)).not.toBe(
      chatRequestFingerprint(first),
    );
    expect(chatRequestFingerprint(changedReasoning)).not.toBe(
      chatRequestFingerprint(first),
    );
  });

  it("rejects malformed JSON", async () => {
    const malformed = new Request("http://example.test/api/chat", {
      method: "POST",
      body: "{",
    });

    await expect(parseChatRequest(malformed)).rejects.toMatchObject({
      name: "ChatRequestError",
      message: "Invalid JSON body",
      status: 400,
    });
  });

  it("accepts an explicit one-message Search request", async () => {
    await expect(
      parseChatRequest(request({ ...validBody, forceSearch: true })),
    ).resolves.toMatchObject({ forceSearch: true });
  });

  it("discards a forced Search request when web search is disabled", async () => {
    await expect(
      parseChatRequest(
        request({
          ...validBody,
          webSearchEnabled: false,
          forceSearch: true,
        }),
      ),
    ).resolves.toMatchObject({
      webSearchEnabled: false,
      forceSearch: false,
    });
  });

  it("trims timezone metadata without putting it in message content", async () => {
    const parsed = await parseChatRequest(
      request({ ...validBody, timeZone: "  America/Los_Angeles  " }),
    );

    expect(parsed.timeZone).toBe("America/Los_Angeles");
    expect(parsed.messages).toEqual(validBody.messages);
  });

  it("maps the legacy mobile search flag without exposing it downstream", async () => {
    const parsed = await parseChatRequest(
      request({ ...validBody, searchEnabled: true }),
    );

    expect(parsed.forceSearch).toBe(true);
    expect(parsed).not.toHaveProperty("searchEnabled");
  });

  it("rejects missing and structurally invalid messages", async () => {
    await expect(
      parseChatRequest(request({ ...validBody, messages: undefined })),
    ).rejects.toBeInstanceOf(ChatRequestError);
    await expect(
      parseChatRequest(
        request({
          ...validBody,
          messages: [{ id: "bad", role: "operator", parts: [] }],
        }),
      ),
    ).rejects.toBeInstanceOf(ChatRequestError);
  });

  it("requires the prepared message list to end in a user message", async () => {
    await expect(
      parseChatRequest(
        request({
          ...validBody,
          messages: [
            {
              id: "assistant",
              role: "assistant",
              parts: [{ type: "text", text: "Hi" }],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      message: "The final message must be a user message",
    });
  });

  it("maps a legacy SDK targetless regenerate request to an explicit retry", async () => {
    const parsed = await parseChatRequest(
      request({ ...validBody, trigger: "regenerate-message" }),
    );

    expect(parsed).toMatchObject({
      action: { type: "retry", userMessageId: "user-message" },
    });
    expect(parsed).not.toHaveProperty("trigger");
    expect(parsed).not.toHaveProperty("messageId");
  });

  it.each([
    {
      trigger: "submit-message" as const,
      messageId: "user-message",
      expectedAction: { type: "edit", targetUserMessageId: "user-message" },
    },
    {
      trigger: "regenerate-message" as const,
      messageId: "assistant-message",
      expectedAction: {
        type: "regenerate",
        targetAssistantMessageId: "assistant-message",
      },
    },
  ])(
    "maps a legacy $trigger target to $expectedAction.type",
    async ({ trigger, messageId, expectedAction }) => {
      await expect(
        parseChatRequest(request({ ...validBody, trigger, messageId })),
      ).resolves.toMatchObject({ action: expectedAction });
    },
  );

  it("preserves an explicit regenerate target", async () => {
    await expect(
      parseChatRequest(
        request({
          ...validBody,
          action: {
            type: "regenerate",
            targetAssistantMessageId: "assistant-message",
          },
        }),
      ),
    ).resolves.toMatchObject({
      action: {
        type: "regenerate",
        targetAssistantMessageId: "assistant-message",
      },
    });
  });

  it("rejects edit and retry actions for a different user message", async () => {
    for (const action of [
      { type: "edit", targetUserMessageId: "other-user" },
      { type: "retry", userMessageId: "other-user" },
    ]) {
      await expect(
        parseChatRequest(request({ ...validBody, action })),
      ).rejects.toMatchObject({
        message: "Chat action does not match the user message",
      });
    }
  });

  it("prefers an explicit action over SDK compatibility fields", async () => {
    await expect(
      parseChatRequest(
        request({
          ...validBody,
          action: { type: "retry", userMessageId: "user-message" },
          trigger: "submit-message",
          messageId: "user-message",
        }),
      ),
    ).resolves.toMatchObject({
      action: { type: "retry", userMessageId: "user-message" },
    });
  });
});
