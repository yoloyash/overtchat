import { PassThrough, Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAgentRuntimeMessageEvent,
  reconcileAgentRuntimeSnapshot,
  isAgentRuntimeEnvelope,
  type AgentRuntimeSnapshot,
} from "@overtchat/agent-bridge";
import {
  configureProcessSpawner,
  type AgentProcessExit,
} from "../runtime/process";
import { startHermesRuntime } from "../hermes/client";
import { listHermesSessions } from "../hermes/sessions";
import type { AgentRuntimeEvent } from "../providers/types";
import { AcpConnection } from "./connection";
import { AgentRuntimeRegistry } from "../runtime/registry";

const clients: ReturnType<typeof startHermesRuntime>[] = [];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.stop();
});

function fixture(overrides: Partial<Agent> = {}) {
  const launches: unknown[] = [];
  const connections: AgentSideConnection[] = [];
  const models = {
    currentModelId: "test:model",
    availableModels: [
      { modelId: "test:model", name: "Test model" },
      { modelId: "test:second", name: "Second" },
    ],
  };
  const modes = {
    currentModeId: "default",
    availableModes: [
      { id: "default", name: "Ask" },
      { id: "dont_ask", name: "Don't Ask" },
    ],
  };
  let wire!: AgentSideConnection;
  const update = (update: SessionUpdate) =>
    wire.sessionUpdate({ sessionId: "session-1", update });
  const setModel = vi.fn(async () => ({}));
  const setMode = vi.fn(async () => ({}));
  const killed = vi.fn();
  const agent: Agent = {
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: { list: {} },
      },
    }),
    authenticate: async () => ({}),
    newSession: async () => {
      setTimeout(() => {
        void update({
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "compress", description: "Compress context" },
          ],
        });
      }, 0);
      return { sessionId: "session-1", models, modes };
    },
    loadSession: async () => {
      await update({
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "older prompt" },
      });
      await update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "older answer" },
      });
      return { models, modes };
    },
    prompt: async () => {
      await update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      });
      await update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      });
      await update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      });
      return { stopReason: "end_turn" };
    },
    cancel: async () => {},
    listSessions: async () => ({ sessions: [] }),
    setSessionMode: setMode,
    unstable_setSessionModel: setModel,
    ...overrides,
  };
  configureProcessSpawner((_target, launch) => {
    launches.push(launch);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let resolveExit!: (exit: AgentProcessExit) => void;
    const exit = new Promise<AgentProcessExit>((resolve) => {
      resolveExit = resolve;
    });
    wire = new AgentSideConnection(
      () => agent,
      ndJsonStream(
        Writable.toWeb(stdout),
        Readable.toWeb(stdin) as ReadableStream<Uint8Array>,
      ),
    );
    connections.push(wire);
    return {
      stdin,
      stdout,
      stderr,
      exit,
      kill: () => {
        killed();
        stdout.end();
        stdin.end();
        stderr.end();
        resolveExit({ code: 0, signal: null });
        return true;
      },
    };
  });
  const start = (resume = false) => {
    const client = startHermesRuntime(
      { transport: "ssh", alias: "test-host" },
      {
        executable: "/bin/hermes",
        cwd: "/workspace",
        ...(resume
          ? {
              resume: {
                providerSessionId: "session-1",
                providerSessionPath: "session-1",
              },
            }
          : {}),
      },
    );
    clients.push(client);
    return client;
  };
  return {
    start,
    update,
    launches,
    setModel,
    setMode,
    killed,
    get wire() {
      return wire;
    },
    connections,
  };
}

async function idle(client: ReturnType<typeof startHermesRuntime>) {
  await vi.waitFor(async () =>
    expect((await client.getState()).isStreaming).toBe(false),
  );
}

describe("ACP runtime using the official SDK over stdio", () => {
  it.each([
    { withImages: false, stopReason: "cancelled" as const },
    { withImages: true, stopReason: "cancelled" as const },
    { withImages: false, stopReason: "end_turn" as const },
  ])(
    "restarts a steered turn and acknowledges before replacement approval ($withImages, $stopReason)",
    async ({ withImages, stopReason }) => {
      const main = deferred();
      const cancelled = deferred();
      const prompts: unknown[] = [];
      const setup = fixture({
        prompt: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            await main.promise;
            return { stopReason };
          }
          await setup.wire.requestPermission({
            sessionId: "session-1",
            toolCall: {
              toolCallId: "replacement-tool",
              title: "Run command",
              rawInput: { command: "echo test" },
            },
            options: [
              { optionId: "once", name: "Allow once", kind: "allow_once" },
            ],
          });
          await setup.update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Replacement done" },
          });
          return { stopReason: "end_turn" };
        },
        cancel: async () => {
          cancelled.resolve();
        },
      });
      const registry = new AgentRuntimeRegistry({
        resolveImages: async (images) =>
          images.map((image) => ({ ...image, data: "aW1hZ2U=" })),
      });
      try {
        const runtime = await registry.getOrStart({
          connectionId: "connection",
          workspaceId: "workspace",
          provider: "hermes",
          target: { transport: "local" },
          executable: "hermes",
          cwd: "/workspace",
          sessionId: "test",
          providerSessionId: "session-1",
          providerSessionPath: "session-1",
          launchConfig: {},
        });
        const events: string[] = [];
        runtime.subscribe((envelope) => {
          if (envelope.type === "runtime_event")
            events.push(envelope.data.type);
        });
        await runtime.command(
          { type: "prompt", message: "Original" },
          "original",
        );
        const images = withImages
          ? [
              {
                uploadId: "00000000-0000-4000-8000-000000000001",
                filename: "test.png",
                mediaType: "image/png" as const,
              },
            ]
          : [];
        await runtime.command(
          { type: "queue", message: "Correction", images },
          "correction",
        );
        await runtime.command({ type: "queue", message: "Later" }, "later");
        let accepted = false;
        const steered = runtime
          .command({ type: "steer_queued_message", id: "correction" })
          .then(() => {
            accepted = true;
          });
        await cancelled.promise;
        expect(prompts).toHaveLength(1); // Do not overlap ACP turns.
        main.resolve();
        await vi.waitFor(() => expect(accepted).toBe(true));
        await steered;
        await vi.waitFor(() =>
          expect(runtime.snapshot().pendingInteraction).toBeDefined(),
        );
        expect(runtime.snapshot().status).toBe("running");
        expect(
          runtime.snapshot().queuedMessages.map((message) => message.id),
        ).toEqual(["later"]);
        expect(prompts).toEqual([
          [{ type: "text", text: "Original" }],
          [
            { type: "text", text: "Correction" },
            ...(withImages
              ? [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]
              : []),
          ],
        ]);
        expect(events.filter((type) => type === "turn_start")).toHaveLength(2);
        expect(events.filter((type) => type === "turn_end")).toHaveLength(1);
        expect(
          runtime
            .snapshot()
            .messages.filter(
              (message) =>
                Reflect.get(message as object, "overtchatSubmissionId") ===
                "correction",
            ),
        ).toHaveLength(1);
        await runtime.command({ type: "remove_queued_message", id: "later" });
        await runtime.command({
          type: "interaction_response",
          id: runtime.snapshot().pendingInteraction!.id,
          value: "once",
        });
        await vi.waitFor(() => expect(runtime.snapshot().status).toBe("idle"));
        expect(events.filter((type) => type === "turn_end")).toHaveLength(2);
      } finally {
        main.resolve();
        await registry.stopAll();
      }
    },
  );

  it("emits bridge-valid context and token usage without blocking later events", async () => {
    const setup = fixture({
      prompt: async () => {
        await setup.update({
          sessionUpdate: "usage_update",
          used: 100,
          size: 1000,
          cost: { amount: 0.02, currency: "USD" },
        });
        return {
          stopReason: "end_turn",
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        };
      },
    });
    const client = setup.start();
    const events: AgentRuntimeEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.prompt("usage");
    await idle(client);
    for (const [index, event] of events.entries()) {
      expect(
        isAgentRuntimeEnvelope({
          type: "runtime_event",
          epoch: "test",
          sequence: index + 1,
          data: event,
        }),
        event.type,
      ).toBe(true);
    }
    expect(events).toContainEqual({
      type: "usage_update",
      usage: {
        contextUsage: { tokens: 100, contextWindow: 1000, percent: 10 },
        cost: 0.02,
      },
    });
    expect(events).toContainEqual({
      type: "usage_update",
      usage: {
        tokens: {
          input: 100,
          output: 20,
          total: 120,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    });
  });
  it("reports request timeouts as terminal failures and cleans up the process", async () => {
    const setup = fixture();
    const exited = vi.fn();
    const connection = await AcpConnection.start(
      { transport: "local" },
      { command: "hermes", args: ["acp"], cwd: "/workspace" },
      "Hermes",
      {
        sessionUpdate: async () => {},
        requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      },
      exited,
    );
    try {
      await connection.initialize();
      await expect(
        connection.request(new Promise(() => {}), "test", 10),
      ).rejects.toThrow("timed out");
      expect(exited).toHaveBeenCalledTimes(1);
    } finally {
      await connection.stop();
    }
    expect(setup.killed).toHaveBeenCalledTimes(1);
  });

  it("forwards image attachments using native ACP content blocks", async () => {
    const prompt = vi.fn(async () => ({ stopReason: "end_turn" as const }));
    const setup = fixture({ prompt });
    const client = setup.start();
    await client.prompt("describe", [
      {
        data: "aW1hZ2U=",
        mediaType: "image/png",
        uploadId: "image-1",
        filename: "fixture.png",
      },
    ]);
    await idle(client);
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          { type: "text", text: "describe" },
          { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
        ],
      }),
    );
  });

  it("settles failed prompts and allows another turn", async () => {
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(new Error("model unavailable"))
      .mockResolvedValue({ stopReason: "end_turn" });
    const setup = fixture({ prompt });
    const client = setup.start();
    const events: AgentRuntimeEvent[] = [];
    client.onEvent((event) => events.push(event));
    await client.prompt("first");
    await idle(client);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "rpc_error",
        error: expect.stringContaining("model unavailable"),
      }),
    );
    expect(events).toContainEqual({ type: "turn_end" });
    await client.prompt("retry");
    await idle(client);
    expect(prompt).toHaveBeenCalledTimes(2);
  });

  it("replaces cleared history after a native reset command", async () => {
    const load = vi.fn(async () => ({}));
    const setup = fixture({ loadSession: load });
    const client = setup.start();
    await client.prompt("before reset");
    await idle(client);
    expect((await client.getMessages()).messages.length).toBeGreaterThan(0);
    await client.prompt("/reset");
    await idle(client);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await client.getMessages()).messages).toEqual([]);
  });
  it("launches on the configured host, streams a turn and preserves the submission identity", async () => {
    const setup = fixture();
    const client = setup.start();
    let projected: unknown[] = [];
    client.onEvent((event) => {
      projected = applyAgentRuntimeMessageEvent(projected, event);
    });
    expect((await client.getState()).sessionId).toBe("session-1");
    expect(setup.launches[0]).toMatchObject({
      command: "/bin/hermes",
      args: ["acp"],
      cwd: "/workspace",
    });
    expect((await client.getAvailableModels())[0]).toMatchObject({
      provider: "hermes",
      input: ["text", "image"],
    });
    expect(await client.getCommands()).toContainEqual(
      expect.objectContaining({ name: "compress" }),
    );
    await client.prompt("hello", [], { clientMessageId: "submission-1" });
    await idle(client);
    expect(projected).toEqual((await client.getMessages()).messages);
    expect(projected).toMatchObject([
      { role: "user", overtchatSubmissionId: "submission-1" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "thinking" },
          { type: "text", text: "Hello world" },
        ],
      },
    ]);
    await client.setModel("test:second");
    await client.setMode("dont_ask");
    expect((await client.getState()).modes).toContainEqual(
      expect.objectContaining({ id: "dont_ask", dangerous: true }),
    );
    expect(setup.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "test:second" }),
    );
    expect(setup.setMode).toHaveBeenCalledWith(
      expect.objectContaining({ modeId: "dont_ask" }),
    );
    await expect(client.setModel("invented")).rejects.toThrow(
      "did not advertise",
    );
  });

  it("loads history before the load response without emitting live turns", async () => {
    const setup = fixture();
    const client = setup.start(true);
    const events: AgentRuntimeEvent[] = [];
    client.onEvent((event) => events.push(event));
    expect((await client.getMessages()).messages).toMatchObject([
      { role: "user" },
      { role: "assistant" },
    ]);
    expect(events).toEqual([]);
    await client.prompt("next");
    await idle(client);
    expect(
      (await client.getMessages()).messages.filter(
        (m) => Reflect.get(m as object, "role") === "user",
      ),
    ).toHaveLength(2);
  });

  it("serializes concurrent approvals and preserves opaque option values", async () => {
    let choices: unknown[] = [];
    const setup = fixture({
      prompt: async () => {
        const permission = (toolCallId: string) =>
          setup.wire.requestPermission({
            sessionId: "session-1",
            toolCall: {
              toolCallId,
              title: "Edit fixture",
              rawInput: { path: "fixture.txt" },
            },
            options: [
              {
                optionId: "allow:once",
                name: "Allow once",
                kind: "allow_once",
              },
              {
                optionId: "allow:session",
                name: "Allow for session",
                kind: "allow_always",
              },
              {
                optionId: "allow:forever",
                name: "Allow always",
                kind: "allow_always",
              },
              { optionId: "deny:once", name: "Deny", kind: "reject_once" },
            ],
          });
        choices = await Promise.all([permission("a"), permission("b")]);
        return { stopReason: "end_turn" };
      },
    });
    const client = setup.start();
    const requests: AgentRuntimeEvent[] = [];
    client.onEvent((event) => {
      if (event.type === "interaction_request") requests.push(event);
    });
    await client.prompt("edit");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      approvalKind: "tool",
      title: "Edit fixture",
      toolDetail: { type: "json", value: { path: "fixture.txt" } },
      approvalChoices: [
        { value: "allow:once", kind: "allow" },
        { value: "allow:session", kind: "always" },
        { value: "allow:forever", kind: "always" },
        { value: "deny:once", kind: "deny" },
      ],
    });
    expect(() =>
      client.respondToInteraction(String(requests[0].id), { value: "unknown" }),
    ).toThrow();
    client.respondToInteraction(String(requests[0].id), {
      value: "allow:session",
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    client.respondToInteraction(String(requests[1].id), { cancelled: true });
    await idle(client);
    expect(choices).toEqual([
      { outcome: { outcome: "selected", optionId: "allow:session" } },
      { outcome: { outcome: "cancelled" } },
    ]);
  });

  it("cancels pending permission requests and settles the active turn", async () => {
    let cancelled = false;
    const setup = fixture({
      prompt: async () => {
        const result = await setup.wire.requestPermission({
          sessionId: "session-1",
          toolCall: { toolCallId: "call" },
          options: [],
        });
        cancelled = result.outcome.outcome === "cancelled";
        return { stopReason: "cancelled" };
      },
    });
    const client = setup.start();
    let permission = false;
    client.onEvent((event) => {
      if (event.type === "interaction_request") permission = true;
    });
    await client.prompt("wait");
    await vi.waitFor(() => expect(permission).toBe(true));
    await client.abort();
    expect(cancelled).toBe(true);
    expect((await client.getState()).isStreaming).toBe(false);
  });

  it("keeps tool updates, diffs, final text and replay reconciliation coherent", async () => {
    const setup = fixture({
      prompt: async () => {
        await setup.update({
          sessionUpdate: "tool_call",
          toolCallId: "edit-1",
          title: "Edit",
          kind: "edit",
          status: "in_progress",
          rawInput: { path: "a.txt" },
        });
        await setup.update({
          sessionUpdate: "tool_call_update",
          toolCallId: "edit-1",
          content: [
            { type: "diff", path: "a.txt", oldText: "old", newText: "new" },
          ],
          status: "completed",
        });
        await setup.update({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Done" },
        });
        return { stopReason: "end_turn" };
      },
    });
    const client = setup.start();
    let projected: unknown[] = [];
    client.onEvent((event) => {
      projected = applyAgentRuntimeMessageEvent(projected, event);
    });
    await client.prompt("edit a.txt");
    await idle(client);
    expect(projected).toEqual((await client.getMessages()).messages);
    expect(projected).toMatchObject([
      { role: "user" },
      {
        role: "assistant",
        content: [
          { type: "toolCall", arguments: { oldText: "old", newText: "new" } },
        ],
      },
      { role: "toolResult", overtchatPartial: false },
      { role: "assistant", content: [{ text: "Done" }] },
    ]);
    const resumed = setup.start(true);
    const fresh = (await resumed.getMessages()).messages;
    const snapshot: AgentRuntimeSnapshot = {
      sessionId: "test",
      provider: "hermes",
      capabilities: { steer: false },
      status: "idle",
      activeTurn: null,
      state: {},
      models: [],
      commands: [],
      messages: fresh,
      stats: await resumed.getSessionStats(),
      queuedMessages: [],
    };
    expect(
      reconcileAgentRuntimeSnapshot(
        { ...snapshot, messages: projected },
        snapshot,
      ).messages,
    ).toEqual(fresh);
  });

  it("paginates workspace discovery without reading the provider database", async () => {
    const list = vi.fn(async ({ cursor }: { cursor?: string | null }) =>
      cursor
        ? { sessions: [{ sessionId: "b", cwd: "/workspace", title: "Second" }] }
        : {
            sessions: [
              { sessionId: "a", cwd: "/workspace", title: "First" },
              { sessionId: "foreign", cwd: "/another" },
            ],
            nextCursor: "page2",
          },
    );
    const setup = fixture({ listSessions: list });
    const sessions = await listHermesSessions(
      { transport: "local" },
      "hermes",
      "/workspace",
    );
    expect(sessions.map((s) => s.providerSessionId)).toEqual(["a", "b"]);
    expect(list).toHaveBeenCalledTimes(2);
    expect(setup.killed).toHaveBeenCalled();
  });
});
