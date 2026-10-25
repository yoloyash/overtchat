import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), ticket: vi.fn(), principal: vi.fn(), run: vi.fn(), publish: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/voice/internal-auth", () => ({ authorizeVoiceService: mocks.authorize }));
vi.mock("@/lib/voice/ticket", () => ({ verifyVoiceTicket: mocks.ticket }));
vi.mock("@/lib/db/voiceSessions", () => ({ getVoicePrincipal: mocks.principal }));
vi.mock("@/lib/voice/events", () => ({ publishVoiceEvent: mocks.publish }));
vi.mock("@/lib/chat/run", () => ({ runChat: mocks.run, chatErrorResponse: () => new Response("Error", { status: 500 }) }));
import { POST } from "./route";
const request = (extra = {}) => new Request("http://app.test/api/internal/voice/v1/chat/completions", {
  method: "POST", body: JSON.stringify({ model: "ticket", overtchat_turn_id: "turn", messages: [
    { role: "system", content: "Client-controlled instructions" }, { role: "assistant", content: "Stale history" },
    { role: "user", content: "Speak now" },
  ], ...extra }),
});
describe("unified voice bridge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockReturnValue(true);
    mocks.ticket.mockReturnValue({ sessionId: "voice", userId: "user", chatId: "chat", projectId: null,
      modelConfigId: "model", webSearchEnabled: true, timeZone: "UTC", reasoningLevel: "high", expiresAt: Date.now() / 1000 + 600 });
    mocks.principal.mockReturnValue({ id: "user", role: "admin" });
    mocks.run.mockResolvedValue(new Response("Conflict", { status: 409 }));
  });
  it("passes only the latest user input and signed settings to the shared service", async () => {
    expect((await POST(request())).status).toBe(409);
    expect(mocks.run).toHaveBeenCalledWith(expect.any(Request), { id: "user", role: "admin" }, expect.objectContaining({
      messages: [{ id: "voice:voice:turn", role: "user", parts: [{ type: "text", text: "Speak now" }] }],
      clientRequestId: "voice:voice:turn", responseStyle: "voice", reasoningLevel: "high", webSearchEnabled: true,
    }), expect.objectContaining({ voiceSessionId: "voice" }));
  });
  it("rejects expired leases and unauthenticated sidecars", async () => {
    mocks.principal.mockReturnValue(null);
    expect((await POST(request())).status).toBe(401);
    mocks.authorize.mockReturnValue(false);
    expect((await POST(request({ model: "overtchat" }))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("streams only answer text to speech while publishing rich canonical messages", async () => {
    mocks.run.mockImplementation(async (_req, _user, _parsed, options) => options.respond(new ReadableStream({
      start(controller) {
        for (const chunk of [
          { type: "start", messageId: "answer" },
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "Answer [1]." },
          { type: "text-end", id: "text" },
          { type: "finish", messageMetadata: { stats: { outputTokens: 5 } } },
        ]) controller.enqueue(chunk);
        controller.close();
      },
    })));
    const response = await POST(request());
    const body = await response.text();
    expect(body).toContain('"content":"Answer [1]."');
    expect(body).toContain("[DONE]");
    expect(mocks.publish).toHaveBeenCalledWith("voice", { type: "message", message: expect.objectContaining({
      id: "answer", metadata: { stats: { outputTokens: 5 } }, parts: expect.arrayContaining([expect.objectContaining({ text: "Answer [1]." })]),
    }) });
    expect(mocks.publish).toHaveBeenLastCalledWith("voice", { type: "settled" });
  });
  it("publishes the latest text even when the provider pauses after a fast first delta", async () => {
    let writer!: ReadableStreamDefaultController<import("ai").UIMessageChunk>;
    mocks.run.mockImplementation(async (_req, _user, _parsed, options) => options.respond(new ReadableStream({
      start(controller) { writer = controller; },
    })));
    const response = await POST(request());
    writer.enqueue({ type: "start", messageId: "answer" });
    writer.enqueue({ type: "text-start", id: "text" });
    writer.enqueue({ type: "text-delta", id: "text", delta: "Partial answer" });
    try {
      await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledWith("voice", { type: "message", message: expect.objectContaining({
        parts: expect.arrayContaining([expect.objectContaining({ text: "Partial answer" })]),
      }) }));
    } finally {
      writer.enqueue({ type: "text-end", id: "text" });
      writer.enqueue({ type: "finish" });
      writer.close();
      await response.text();
    }
  });

  it("strips split citations only from speech while retaining canonical citation text", async () => {
    const text = "A fact.\\ue200\\ue202turn0search12\\ue201 More cited wordsturn1ref0.\\ue202turn2sea";
    mocks.run.mockImplementation(async (_req, _user, _parsed, options) => options.respond(new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "start", messageId: "answer" });
        controller.enqueue({ type: "text-start", id: "text" });
        for (const delta of text) controller.enqueue({ type: "text-delta", id: "text", delta });
        controller.enqueue({ type: "text-end", id: "text" });
        controller.enqueue({ type: "finish" });
        controller.close();
      },
    })));
    const response = await POST(request());
    const speech = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line =>
      JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? "").join("");
    expect(speech).toBe("A fact. More cited words.");
    expect(mocks.publish).toHaveBeenCalledWith("voice", { type: "message", message: expect.objectContaining({
      parts: expect.arrayContaining([expect.objectContaining({ text })]),
    }) });
  });

});
