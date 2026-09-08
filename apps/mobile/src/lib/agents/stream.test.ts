import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentHttpError,
  AgentSessionStream,
  createEventParser,
} from "./stream";
import { snapshot } from "./test-fixtures";

const encoder = new TextEncoder();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const onReplica = vi.fn();
  const onStatus = vi.fn();
  const request = vi.fn(async (path: string, signal: AbortSignal) => {
    if (!path.includes("/events"))
      return Response.json({
        snapshot: snapshot(),
        sync: {
          reset: true,
          cursor: { epoch: "epoch", sequence: 0 },
          snapshot: snapshot(),
        },
      });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        body = controller;
        signal.addEventListener(
          "abort",
          () => {
            try {
              controller.error(new Error("aborted"));
            } catch {}
          },
          { once: true },
        );
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream" },
    });
  });
  const client = new AgentSessionStream({
    id: "session",
    request,
    onReplica,
    onStatus,
  });
  return {
    client,
    request,
    onReplica,
    onStatus,
    push: (event: string, data: unknown) =>
      body.enqueue(
        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
      ),
    close: () => body.close(),
  };
}

afterEach(() => vi.useRealTimers());

describe("native SSE parsing", () => {
  it("handles CRLF split across chunks, multiline data, comments, and multiple events", () => {
    const received = vi.fn();
    const parse = createEventParser(received);
    parse(": heartbeat\r");
    parse('\nevent: sync\r\ndata: {\r\ndata: "ok": true}\r\n\r');
    parse("\nevent: runtime\ndata: next\n\n");
    expect(received.mock.calls).toEqual([
      ["sync", '{\n"ok": true}'],
      ["runtime", "next"],
    ]);
  });
  it("does not dispatch an incomplete event", () => {
    const received = vi.fn();
    const parse = createEventParser(received);
    parse("event: runtime\ndata: unfinished");
    expect(received).not.toHaveBeenCalled();
  });
});

describe("agent foreground transport", () => {
  it("hydrates before subscribing with the authoritative cursor and deduplicates events", async () => {
    const h = harness();
    h.client.start();
    await tick();
    expect(h.request.mock.calls[1][0]).toContain("sync=1&after=epoch%3A0");
    const event = {
      epoch: "epoch",
      sequence: 1,
      type: "runtime_event",
      data: { type: "turn_start" },
    };
    h.push("runtime", event);
    h.push("runtime", event);
    await tick();
    expect(h.onReplica).toHaveBeenCalledTimes(2);
    expect(h.onReplica.mock.lastCall?.[0].cursor.sequence).toBe(1);
    h.client.stop();
  });
  it("resynchronizes a sequence gap without applying it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    h.client.start();
    await tick();
    h.push("runtime", {
      epoch: "epoch",
      sequence: 3,
      type: "runtime_event",
      data: { type: "turn_start" },
    });
    await tick();
    expect(h.onReplica).toHaveBeenCalledTimes(1);
    expect(h.onStatus.mock.lastCall?.[0]).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    expect(h.request.mock.calls[2][0]).toBe(
      "/api/agent-sessions/session?after=epoch%3A0",
    );
    h.client.stop();
  });
  it("reconciles a malformed event and a clean stream close", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    h.client.start();
    await tick();
    h.push("sync", { invalid: true });
    await tick();
    await vi.advanceTimersByTimeAsync(1000);
    await tick();
    expect(h.request).toHaveBeenCalledTimes(4);
    h.close();
    await tick();
    expect(h.onStatus.mock.lastCall?.[0]).toBe("reconnecting");
    h.client.stop();
  });
  it("aborts on background, cancels retries, and resumes with a fresh authoritative read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    h.client.start();
    await tick();
    const signal = h.request.mock.calls[1][1];
    h.client.stop();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.client.start();
    await tick();
    expect(h.request.mock.calls[2][0]).toContain("?after=epoch%3A0");
    expect(h.onStatus.mock.lastCall?.[0]).toBe("connected");
    h.client.stop();
  });
  it("recovers a connection that stops delivering heartbeats", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const h = harness();
    h.client.start();
    await tick();
    await vi.advanceTimersByTimeAsync(61_000);
    await tick();
    expect(h.request).toHaveBeenCalledTimes(4);
    h.client.stop();
  });
  it("does not retry denied or deleted sessions", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (const status of [401, 403, 404]) {
      const h = harness();
      h.request.mockRejectedValue(new AgentHttpError("Denied", status));
      h.client.start();
      await tick();
      expect(h.onStatus.mock.lastCall).toEqual(["error", "Denied"]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.request).toHaveBeenCalledTimes(1);
      h.client.stop();
    }
  });
  it("ignores a slow response from a previous foreground generation", async () => {
    const h = harness();
    let resolve!: (response: Response) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    h.client.start();
    h.client.stop();
    h.client.start();
    await tick();
    const count = h.onReplica.mock.calls.length;
    resolve(
      Response.json({
        snapshot: { ...snapshot(), messages: ["old response"] },
      }),
    );
    await tick();
    expect(h.onReplica).toHaveBeenCalledTimes(count);
    expect(h.request).toHaveBeenCalledTimes(3);
    h.client.stop();
  });
  it("accepts an epoch reset and legacy events from older connectors", async () => {
    const h = harness();
    h.client.start();
    await tick();
    h.push("sync", {
      reset: true,
      cursor: { epoch: "new", sequence: 7 },
      snapshot: snapshot("running"),
    });
    await tick();
    expect(h.onReplica.mock.lastCall?.[0].cursor).toEqual({
      epoch: "new",
      sequence: 7,
    });
    h.push("legacy-runtime", {
      epoch: "new",
      sequence: 10,
      type: "runtime_event",
      data: { type: "turn_end" },
    });
    await tick();
    expect(h.onReplica.mock.lastCall?.[0].cursor.sequence).toBe(10);
    h.client.stop();
  });
});
