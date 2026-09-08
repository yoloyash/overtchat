import { afterEach, describe, expect, it, vi } from "vitest";
import { convertToModelMessages, ToolLoopAgent, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { assertUploadedAttachments, rejectAttachmentDownloads } from "./attachment-security";

afterEach(() => vi.unstubAllGlobals());

function message(url: string): UIMessage {
  return {
    id: "message", role: "user",
    parts: [{ type: "file", mediaType: "image/png", url }],
  };
}

describe("chat attachment boundary", () => {
  it("accepts upload references for resolution under the authenticated user", () => {
    expect(() => assertUploadedAttachments([message("/api/uploads/owned-id")])).not.toThrow();
  });

  it.each([
    "https://example.com/image.png", "http://searxng:8080/",
    "http://127.0.0.1/image.png", "//example.com/image.png",
    "data:image/png;base64,aGVsbG8=", "file:///etc/passwd",
    "/api/uploads/", "/api/uploads/id/other", "/api/uploads/id?download=1",
  ])("rejects unsupported attachment %s", (url) => {
    expect(() => assertUploadedAttachments([message(url)])).toThrow("Upload the file again");
  });

  it("checks persisted assistant attachments and reasoning files too", () => {
    expect(() => assertUploadedAttachments([
      { ...message("https://example.com/image.png"), role: "assistant" },
    ])).toThrow("Upload the file again");
    expect(() => assertUploadedAttachments([{
      id: "reasoning", role: "assistant",
      parts: [{ type: "reasoning-file", mediaType: "image/png", url: "/api/uploads/id" }],
    }])).toThrow("Upload the file again");
  });

  it.each([false, true])("blocks SDK URL downloads even when provider URL support is %s", async (supported) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const model = new MockLanguageModelV4({
      supportedUrls: supported ? { "image/*": [/.*/] } : {},
    });
    const agent = new ToolLoopAgent({ model, experimental_download: rejectAttachmentDownloads, maxRetries: 0 });

    await expect(agent.generate({
      messages: await convertToModelMessages([message("https://example.com/image.png")]),
    })).rejects.toThrow("Upload the file again");
    expect(fetch).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("passes inlined upload bytes to the model without fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      },
    });
    const agent = new ToolLoopAgent({ model, experimental_download: rejectAttachmentDownloads });
    const result = await agent.generate({
      messages: await convertToModelMessages([message("data:image/png;base64,aGVsbG8=")]),
    });
    expect(result.text).toBe("ok");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("also blocks remote files nested in tool results", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const model = new MockLanguageModelV4();
    const agent = new ToolLoopAgent({ model, experimental_download: rejectAttachmentDownloads, maxRetries: 0 });
    await expect(agent.generate({ messages: [{
      role: "tool",
      content: [{
        type: "tool-result", toolCallId: "call", toolName: "image",
        output: { type: "content", value: [{
          type: "file", mediaType: "image/png",
          data: { type: "url", url: new URL("https://example.com/image.png") },
        }] },
      }],
    }] })).rejects.toThrow("Upload the file again");
    expect(fetch).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
