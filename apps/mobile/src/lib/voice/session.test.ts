import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileVoiceSession, type VoiceOptions } from "./session";

const options: VoiceOptions = { chatId: "chat", projectId: null, modelConfigId: "model", webSearchEnabled: true, reasoningLevel: "default", timeZone: "UTC" };
const grant = { token: "test-ticket", sessionId: "session", chatId: "chat", endpoint: "/api/voice/realtime", voice: "test" };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let callbacks!: Parameters<import("./session").VoiceDependencies["createClient"]>[1];
  const client = { connect: vi.fn(async () => {}), close: vi.fn(async () => {}), setMuted: vi.fn(), sendMessage: vi.fn(async () => {}), setActiveTurn: vi.fn(), interrupt: vi.fn() };
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    if (path === "/api/voice/session") return init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json(grant);
    if (path === "/api/voice/events") return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } }));
    if (path.endsWith("/stream/status")) return Response.json({ active: false });
    return Response.json({ messages: [] });
  });
  const onMessage = vi.fn(), onRefresh = vi.fn(), onPersisted = vi.fn();
  const createClient = vi.fn((_grant, cb) => { callbacks = cb; return client; });
  const session = new MobileVoiceSession({ request, createClient, onMessage, onRefresh, onPersisted });
  return { session, client, request, createClient, onMessage, onRefresh, onPersisted,
    callbacks: () => callbacks,
    event: (event: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
    disconnect: () => stream.close() };
}
afterEach(() => vi.useRealTimers());

describe("foreground voice lifecycle", () => {
  it("ignores delayed audio callbacks from a previous call", async () => {
    const h = harness();
    await h.session.start(options);
    const stale = h.callbacks();
    await h.session.end();
    await h.session.start(options);
    h.callbacks().onStatus("listening");
    stale.onStatus("assistant-speaking");
    stale.onError(new Error("Old socket closed"));
    expect(h.session.getSnapshot().status).toBe("listening");
    expect(h.session.getSnapshot().error).toBeNull();
    await h.session.end();
  });
  it("releases a lease when the realtime socket never connects", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.client.connect.mockImplementationOnce(() => new Promise(() => {}));
    const starting = h.session.start(options);
    await flush();
    await vi.advanceTimersByTimeAsync(30_000);
    await starting;
    await flush();
    expect(h.client.close).toHaveBeenCalled();
    expect(h.session.getSnapshot().status).toBe("idle");
    expect(h.request.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });
  it("subscribes to canonical history before opening audio and refuses typed input during startup", async () => {
    const h = harness();
    const gate = deferred<Response>();
    h.request.mockImplementationOnce(() => gate.promise);
    const starting = h.session.start(options);
    expect(await h.session.sendMessage("keep this draft")).toBe(false);
    expect(h.client.connect).not.toHaveBeenCalled();
    gate.resolve(Response.json(grant));
    await starting;
    expect(h.request.mock.calls.map(([path]) => path)).toEqual(["/api/voice/session", "/api/voice/events"]);
    expect(h.client.connect).toHaveBeenCalledOnce();
    await h.session.end();
  });
  it("releases a late grant after End without ever opening the microphone", async () => {
    const h = harness();
    const gate = deferred<Response>();
    h.request.mockImplementationOnce(() => gate.promise);
    void h.session.start(options);
    const ending = h.session.end();
    gate.resolve(Response.json(grant));
    await ending;
    expect(h.createClient).not.toHaveBeenCalled();
    expect(h.request.mock.calls.filter(([,init]) => init?.method === "DELETE")).toHaveLength(1);
    expect(h.session.getSnapshot().status).toBe("idle");
  });
  it("does not acquire another lease on repeated starts and coalesces End", async () => {
    const h = harness();
    await Promise.all([h.session.start(options), h.session.start(options)]);
    const first = h.session.end();
    expect(h.session.end()).toBe(first);
    await first;
    expect(h.createClient).toHaveBeenCalledOnce();
    expect(h.request.mock.calls.filter(([,init]) => init?.method === "DELETE")).toHaveLength(1);
  });
  it("closes devices immediately while session release is still pending", async () => {
    const h = harness();
    await h.session.start(options);
    const gate = deferred<Response>();
    h.request.mockImplementationOnce(() => gate.promise);
    const ending = h.session.end();
    expect(h.client.close).toHaveBeenCalled();
    expect(h.session.getSnapshot().status).toBe("ending");
    expect(await h.session.sendMessage("keep draft")).toBe(false);
    gate.resolve(new Response(null, { status: 204 }));
    await ending;
  });
  it("retains the ending gate on failed cleanup and allows retry", async () => {
    const h = harness();
    await h.session.start(options);
    h.request.mockImplementationOnce(async () => new Response(null, { status: 503 }));
    await expect(h.session.end()).rejects.toThrow();
    expect(h.session.getSnapshot().status).toBe("ending");
    expect(h.session.getSnapshot().error).toContain("End again");
    await h.session.start(options);
    expect(h.createClient).toHaveBeenCalledOnce();
    await h.session.end();
    expect(h.session.getSnapshot().status).toBe("idle");
    expect(h.session.getSnapshot().error).toBeNull();
  });
  it("upserts canonical messages and targets the active voice turn", async () => {
    const h = harness();
    await h.session.start(options);
    const message = { id: "voice:session:turn", role: "user", parts: [{ type: "text", text: "hello" }] };
    h.event({ type: "message", message });
    await flush();
    expect(h.onMessage).toHaveBeenCalledWith(message);
    expect(h.client.setActiveTurn).toHaveBeenCalledWith(message.id);
    h.event({ type: "settled" });
    await flush();
    expect(h.client.setActiveTurn).toHaveBeenLastCalledWith(null);
    expect(h.onRefresh).toHaveBeenCalled();
    await h.session.end();
  });
  it("ends on event-stream loss and ignores subsequent device callbacks", async () => {
    const h = harness();
    await h.session.start(options);
    h.disconnect();
    await flush();
    await h.session.end();
    expect(h.client.close).toHaveBeenCalled();
    h.callbacks().onStatus("listening");
    expect(h.session.getSnapshot().status).toBe("idle");
    expect(h.session.getSnapshot().error).toContain("lost its connection");
  });
  it("ends on a native interruption and never resumes from a late event", async () => {
    const h = harness();
    await h.session.start(options);
    h.callbacks().onError(new Error("interrupted"));
    await h.session.end();
    h.callbacks().onStatus("listening");
    expect(h.session.getSnapshot().status).toBe("idle");
  });
  it("does not drop a draft when submission fails", async () => {
    const h = harness();
    await h.session.start(options);
    h.callbacks().onStatus("listening");
    h.client.sendMessage.mockRejectedValueOnce(new Error("unconfirmed"));
    expect(await h.session.sendMessage("hello")).toBe(false);
    expect(h.session.getSnapshot().warning).toContain("not confirmed");
    expect(await h.session.sendMessage("hello")).toBe(true);
    await h.session.end();
  });
  it("keeps cleanup retry available after dismissing an unrelated warning", async () => {
    const h = harness();
    await h.session.start(options);
    h.callbacks().onStatus("listening");
    h.client.sendMessage.mockRejectedValueOnce(new Error("unconfirmed"));
    await h.session.sendMessage("keep draft");
    const release = deferred<Response>();
    h.request.mockImplementationOnce(() => release.promise);
    const ending = h.session.end();
    expect(h.session.getSnapshot().cleanupPending).toBe(true);
    release.resolve(new Response(null, { status: 503 }));
    await expect(ending).rejects.toThrow();
    expect(h.session.getSnapshot().cleanupPending).toBe(false);
    h.session.dismissWarning();
    expect(h.session.getSnapshot().warning).toBeNull();
    expect(h.session.getSnapshot().error).toContain("End again");
    // Even dismissing the error cannot masquerade as an in-flight cleanup.
    h.session.dismissError();
    expect(h.session.getSnapshot().cleanupPending).toBe(false);
    expect(h.session.getSnapshot().status).toBe("ending");
    await h.session.end();
    expect(h.session.getSnapshot().status).toBe("idle");
    expect(h.session.getSnapshot().cleanupPending).toBe(false);
  });
  it("keeps an unconfirmed-send warning across unrelated assistant updates", async () => {
    const h = harness();
    await h.session.start(options);
    h.callbacks().onStatus("listening");
    h.client.sendMessage.mockRejectedValueOnce(new Error("unconfirmed"));
    await h.session.sendMessage("keep draft");
    h.event({ type: "message", message: { id: "previous-answer", role: "assistant", parts: [{ type: "text", text: "Still responding" }] } });
    await flush();
    expect(h.session.getSnapshot().warning).toContain("not confirmed");
    h.session.dismissWarning();
    expect(h.session.getSnapshot().warning).toBeNull();
    await h.session.end();
  });
  it("reports a session conflict and leaves text available", async () => {
    const h = harness();
    h.request.mockImplementationOnce(async () => new Response(null, { status: 409 }));
    await h.session.start(options);
    await h.session.end();
    expect(h.session.getSnapshot().status).toBe("idle");
    expect(h.session.getSnapshot().error).toContain("already has an active");
    expect(h.createClient).not.toHaveBeenCalled();
  });
  it("abandons silent broken streams after the heartbeat deadline", async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.session.start(options);
    await vi.advanceTimersByTimeAsync(45_001);
    await h.session.end();
    expect(h.session.getSnapshot().error).toContain("lost its connection");
    expect(h.client.close).toHaveBeenCalled();
  });
});
