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

describe("OpenCode runtime client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({
      baseUrl: "http://127.0.0.1:4096",
      exit: new Promise(() => {}),
      release: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("pins steering to the active turn while settings change for the next turn", async () => {
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
          stream: (async function* () {})(),
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
        create: vi.fn().mockResolvedValue({ data: session }),
        messages: vi.fn().mockResolvedValue({ data: [] }),
        todo: vi.fn().mockResolvedValue({ data: [] }),
        status: vi.fn().mockResolvedValue({ data: { "ses-1": { type: "idle" } } }),
        promptAsync,
      },
    };
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
    const event = vi.fn().mockImplementation(
      async ({ signal }: { signal: AbortSignal }) => {
        eventSignal = signal;
        return { stream: (async function* () {})() };
      },
    );
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
});
