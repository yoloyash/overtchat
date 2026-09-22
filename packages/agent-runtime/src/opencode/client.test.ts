import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
  acquire: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2/client", () => ({
  createOpencodeClient: mocks.createOpencodeClient,
}));
vi.mock("@overtchat/agent-runtime/opencode/server", () => ({
  openCodeServerPool: { acquire: mocks.acquire },
}));

import { listOpenCodeSessions, OpenCodeRuntimeClient } from "./client";

function providerModel(id: string) {
  return {
    id,
    name: id.toUpperCase(),
    family: "test",
    api: { id, url: "https://example.test" },
    capabilities: {
      reasoning: true,
      attachment: false,
      input: { text: true, image: false },
    },
    variants: { high: {} },
    limit: { context: 100_000, output: 10_000 },
    cost: { input: 1, output: 2, cache: { read: 0, write: 0 } },
  };
}

function sdkFixture() {
  const promptAsync = vi.fn().mockResolvedValue({ data: undefined });
  const session = {
    id: "ses-1",
    title: "New session",
    metadata: {},
    time: { created: 1, updated: 1 },
    model: { providerID: "provider", id: "model-a", variant: "high" },
    agent: "build",
  };
  const sdk = {
    global: {
      event: vi.fn().mockResolvedValue({
        stream: (async function* () { yield { directory: "global", payload: { type: "server.connected", properties: {} } }; })(),
      }),
    },
    provider: {
      list: vi.fn().mockResolvedValue({
        data: {
          all: [
            {
              id: "provider",
              name: "Provider",
              source: "api",
              models: {
                "model-a": providerModel("model-a"),
                "model-b": providerModel("model-b"),
              },
            },
          ],
          connected: ["provider"],
          default: { provider: "model-a" },
        },
      }),
    },
    app: {
      agents: vi.fn().mockResolvedValue({
        data: [
          { name: "build", mode: "primary", description: "Build" },
          { name: "review", mode: "primary", description: "Review" },
        ],
      }),
    },
    command: { list: vi.fn().mockResolvedValue({ data: [] }) },
    config: {
      get: vi.fn().mockResolvedValue({
        data: { model: "provider/model-a", default_agent: "build" },
      }),
    },
    session: {
      abort: vi.fn().mockResolvedValue({ data: true }),
      create: vi.fn().mockResolvedValue({ data: session }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      todo: vi.fn().mockResolvedValue({ data: [] }),
      status: vi
        .fn()
        .mockResolvedValue({ data: { "ses-1": { type: "idle" } } }),
      promptAsync,
    },
  };
  return { sdk, promptAsync };
}

describe("OpenCode runtime client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({
      baseUrl: "http://127.0.0.1:4096",
      exit: new Promise(() => {}),
      release: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("waits for the native event stream handshake before sending a prompt", async () => {
    const { sdk, promptAsync } = sdkFixture();
    let connect: () => void = () => {};
    const connected = new Promise<void>(resolve => { connect = resolve; });
    sdk.global.event.mockResolvedValue({ stream: (async function* () {
      await connected;
      yield { directory: "global", payload: { type: "server.connected", properties: {} } };
    })() });
    mocks.createOpencodeClient.mockReturnValue(sdk);
    const client = new OpenCodeRuntimeClient({ transport: "local" }, { executable: "opencode", cwd: "/workspace" });
    try {
      await client.getState();
      const sending = client.prompt("First prompt");
      await new Promise(resolve => setImmediate(resolve));
      expect(promptAsync).not.toHaveBeenCalled();
      connect();
      await sending;
      expect(promptAsync).toHaveBeenCalledOnce();
    } finally { await client.stop(); }
  });

  it("pins steering to the active turn while settings change for the next turn", async () => {
    const { sdk, promptAsync } = sdkFixture();
    mocks.createOpencodeClient.mockReturnValue(sdk);

    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      {
        executable: "opencode",
        cwd: "/workspace",
        model: "provider/model-a",
        thinkingOptionId: "high",
        modeId: "build",
      },
    );
    try {
      await client.getState();
      await client.prompt("First");
      await client.setModel("provider/model-b");
      await client.setThinkingLevel("default");
      await client.setMode("review");
      await client.steer("Steer");

      expect(promptAsync).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          model: { providerID: "provider", modelID: "model-a" },
          variant: "high",
          agent: "build",
        }),
      );
      expect(promptAsync).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          model: { providerID: "provider", modelID: "model-a" },
          variant: "high",
          agent: "build",
        }),
      );
      await expect(client.getState()).resolves.toMatchObject({
        model: { provider: "opencode", id: "provider/model-b" },
        thinkingLevel: "default",
        modeId: "review",
      });
    } finally {
      await client.stop();
    }
  });

  it("aborts a session before releasing its shared server and joins concurrent stops", async () => {
    const { sdk } = sdkFixture();
    mocks.createOpencodeClient.mockReturnValue(sdk);
    let finishAbort!: () => void;
    sdk.session.abort.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishAbort = () => resolve({ data: true });
        }),
    );
    const lease = await mocks.acquire();
    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      { executable: "opencode", cwd: "/workspace" },
    );
    await client.getState();
    const stopping = client.stop();
    expect(client.stop()).toBe(stopping);
    await vi.waitFor(() => expect(sdk.session.abort).toHaveBeenCalledOnce());
    expect(sdk.session.abort).toHaveBeenCalledWith(
      { sessionID: "ses-1", directory: "/workspace" },
      { signal: expect.any(AbortSignal) },
    );
    expect(lease.release).not.toHaveBeenCalled();
    finishAbort();
    await stopping;
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("releases its lease even when the provider rejects session abort", async () => {
    const { sdk } = sdkFixture();
    mocks.createOpencodeClient.mockReturnValue(sdk);
    sdk.session.abort.mockRejectedValue(new Error("provider unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lease = await mocks.acquire();
    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      { executable: "opencode", cwd: "/workspace" },
    );
    try {
      await client.getState();
      await client.stop();
      expect(lease.release).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("bounds a stalled abort and still releases the server", async () => {
    const { sdk } = sdkFixture();
    mocks.createOpencodeClient.mockReturnValue(sdk);
    sdk.session.abort.mockImplementation(() => new Promise(() => {}));
    const lease = await mocks.acquire();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      { executable: "opencode", cwd: "/workspace" },
    );
    try {
      await client.getState();
      vi.useFakeTimers();
      const stopping = client.stop();
      await vi.advanceTimersByTimeAsync(2_001);
      await stopping;
      expect(lease.release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("keeps listed sessions when one message history cannot be enriched", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.acquire.mockResolvedValueOnce({
      baseUrl: "http://127.0.0.1:4096",
      exit: new Promise(() => {}),
      release,
    });
    const sessions = [
      { id: "ses-1", title: "First", time: { created: 1, updated: 2 } },
      { id: "ses-2", title: "Second", time: { created: 3, updated: 4 } },
    ];
    const messages = vi
      .fn()
      .mockResolvedValueOnce({ error: new Error("fetch failed") })
      .mockResolvedValueOnce({ data: [{ info: { id: "msg-1" }, parts: [] }] });
    mocks.createOpencodeClient.mockReturnValue({
      session: {
        list: vi.fn().mockResolvedValue({ data: sessions }),
        messages,
      },
    });

    await expect(
      listOpenCodeSessions({ transport: "local" }, "opencode", "/workspace"),
    ).resolves.toEqual([
      { session: sessions[0], messages: [] },
      {
        session: sessions[1],
        messages: [{ info: { id: "msg-1" }, parts: [] }],
      },
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("aborts event recovery and releases the server when initialization fails", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    mocks.acquire.mockResolvedValueOnce({
      baseUrl: "http://127.0.0.1:4096",
      exit: new Promise(() => {}),
      release,
    });
    let eventSignal: AbortSignal | undefined;
    const event = vi
      .fn()
      .mockImplementation(async ({ signal }: { signal: AbortSignal }) => {
        eventSignal = signal;
        return { stream: (async function* () {})() };
      });
    mocks.createOpencodeClient.mockReturnValue({
      global: { event },
      provider: {
        list: vi.fn().mockResolvedValue({
          data: {
            all: [
              {
                id: "provider",
                name: "Provider",
                source: "api",
                models: { "model-a": providerModel("model-a") },
              },
            ],
            connected: ["provider"],
            default: { provider: "model-a" },
          },
        }),
      },
      app: { agents: vi.fn().mockResolvedValue({ data: [] }) },
      command: { list: vi.fn().mockResolvedValue({ data: [] }) },
      config: {
        get: vi.fn().mockResolvedValue({ data: { model: "provider/model-a" } }),
      },
    });

    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      {
        executable: "opencode",
        cwd: "/workspace",
        model: "provider/missing",
      },
    );

    await expect(client.getState()).rejects.toThrow(
      "OpenCode did not report configured model provider/missing",
    );
    expect(eventSignal?.aborted).toBe(true);
    expect(event).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("publishes step usage before idle and keeps old history from restoring compacted context", async () => {
    const { sdk } = sdkFixture();
    mocks.createOpencodeClient.mockReturnValue(sdk);
    const client = new OpenCodeRuntimeClient(
      { transport: "local" },
      { executable: "opencode", cwd: "/workspace", model: "provider/model-a" },
    );
    const events: Array<Record<string, unknown>> = [];
    client.onEvent((event) => events.push(event));
    const emit = (type: string, properties: Record<string, unknown>) => {
      (client as unknown as { handleEvent(event: unknown): void }).handleEvent({
        type,
        properties: { sessionID: "ses-1", ...properties },
      });
    };
    const tokens = (input: number) => ({
      input,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    });
    const info = (id: string, input: number, summary = false) => ({
      id,
      role: "assistant",
      sessionID: "ses-1",
      providerID: "provider",
      modelID: "model-a",
      summary,
      tokens: tokens(input),
      cost: 0,
      time: { created: 1 },
      parentID: "user",
      path: { cwd: "/workspace", root: "/workspace" },
      mode: "build",
      agent: "build",
    });
    try {
      await client.getState();
      emit("session.status", { status: { type: "busy" } });
      emit("message.updated", { info: info("old", 90000) });
      emit("message.part.updated", {
        part: {
          id: "step",
          messageID: "old",
          type: "step-finish",
          tokens: tokens(91000),
        },
      });
      expect(events.at(-1)).toMatchObject({
        type: "usage_update",
        usage: { contextUsage: { tokens: 91000 } },
      });
      expect((await client.getState()).isStreaming).toBe(true);
      emit("session.next.compaction.started", {});
      const compactionPart = {
        id: "compaction",
        messageID: "old",
        type: "compaction",
        auto: true,
      };
      emit("message.part.updated", { part: compactionPart });
      emit("message.updated", { info: info("summary", 80000, true) });
      emit("session.next.compaction.ended", {});
      sdk.session.messages.mockResolvedValue({
        data: [{ info: info("old", 90000), parts: [] }],
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBeNull();
      emit("message.updated", { info: info("old", 92000) });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBeNull();
      emit("message.updated", { info: info("next", 0) });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBeNull();
      emit("message.part.updated", {
        part: {
          id: "next-step",
          messageID: "next",
          type: "step-finish",
          tokens: tokens(12000),
        },
      });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(12000);
      emit("message.part.updated", { part: compactionPart });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(12000);
      emit("message.updated", { info: info("empty", 0) });
      expect((await client.getSessionStats()).contextUsage?.tokens).toBe(12000);
    } finally {
      await client.stop();
    }
  });
});
