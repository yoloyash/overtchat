import { describe, expect, it } from "vitest";
import { ChatRequestError, parseChatRequest } from "./request";

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
  it("validates and normalizes a normal submit request", async () => {
    await expect(parseChatRequest(request(validBody))).resolves.toMatchObject({
      ...validBody,
      webSearchEnabled: true,
      forceSearch: false,
      temporary: false,
      trigger: "submit-message",
    });
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

  it("requires regenerate requests to identify their target", async () => {
    await expect(
      parseChatRequest(
        request({ ...validBody, trigger: "regenerate-message" }),
      ),
    ).rejects.toMatchObject({ message: "Regenerate requires a messageId" });
  });
});
