import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentDaemonSessionDescriptor,
  AgentQueuedMessage,
  AgentRuntimeEnvelope,
  HostConnectorCommand,
  HostConnectorEventPayload,
} from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  configureProcessSpawner: vi.fn(),
  create: vi.fn(),
  getOrStart: vi.fn(),
  stopAll: vi.fn(),
  stopSession: vi.fn(),
  stopWorkspace: vi.fn(),
  stopConnection: vi.fn(),
  command: vi.fn(),
  normalizeCommand: vi.fn(),
  snapshot: vi.fn(),
  observe: vi.fn(),
  acquireLease: vi.fn(),
  registryOptions: null as {
    runtimeExited?: (sessionId: string, runtime: unknown) => void | Promise<void>;
    saveQueuedMessages?: (
      sessionId: string,
      messages: readonly AgentQueuedMessage[],
    ) => void | Promise<void>;
  } | null,
}));

vi.mock("@overtchat/agent-runtime", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@overtchat/agent-runtime")
  >();
  return {
    ...original,
    configureProcessSpawner: mocks.configureProcessSpawner,
    AgentRuntimeRegistry: class {
      constructor(options: NonNullable<typeof mocks.registryOptions>) {
        mocks.registryOptions = options;
      }
      create = mocks.create;
      getOrStart = mocks.getOrStart;
      stopAll = mocks.stopAll;
      stopSession = mocks.stopSession;
      stopWorkspace = mocks.stopWorkspace;
      stopConnection = mocks.stopConnection;
    },
  };
});

import { ConnectorDaemon } from "./daemon.js";
import { ConnectorStateJournal } from "./state.js";
import { ConnectorTimelineStore } from "./timeline.js";

const directories: string[] = [];

const session: AgentDaemonSessionDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "codex",
  target: { transport: "local", shellMode: "interactive" },
  executable: "codex",
  cwd: "/workspace",
  sessionId: "session",
  providerSessionId: "provider-session",
  providerSessionPath: "/sessions/provider-session.jsonl",
};

const workspace = {
  connectionId: session.connectionId,
  workspaceId: session.workspaceId,
  provider: session.provider,
  target: session.target,
  executable: session.executable,
  cwd: session.cwd,
};

function runtime() {
  return {
    dbSessionId: "session",
    normalizeCommand: mocks.normalizeCommand,
    command: mocks.command,
    snapshot: mocks.snapshot,
    observe: mocks.observe,
    acquireLease: mocks.acquireLease,
  };
}

function command(requestId: string): HostConnectorCommand {
  return {
    type: "request",
    requestId,
    request: {
      type: "session_command",
      commandId: "message-1",
      clientMessageId: "message-1",
      session,
      command: {
        type: "queue",
        message: "Run the tests",
        clientMessageId: "message-1",
      },
    },
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function openJournal(): Promise<{
  file: string;
  journal: ConnectorStateJournal;
  timelineDirectory: string;
  timelines: ConnectorTimelineStore;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-daemon-"));
  directories.push(directory);
  const file = path.join(directory, "connector.state.json");
  const timelineDirectory = path.join(directory, "timelines");
  return {
    file,
    journal: await ConnectorStateJournal.open(file),
    timelineDirectory,
    timelines: await ConnectorTimelineStore.open(timelineDirectory),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normalizeCommand.mockImplementation((value) => value);
  mocks.command.mockResolvedValue({ queued: true, id: "message-1" });
  mocks.snapshot.mockReturnValue({
    sessionId: "session",
    provider: "codex",
    capabilities: { steer: true },
    status: "running",
    activeTurn: { startedAt: 42 },
    state: { isStreaming: true },
    messages: [],
    models: [],
    thinkingLevels: [],
    commands: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
    queuedMessages: [
      { id: "message-1", message: "Run the tests", status: "pending" },
    ],
  });
  mocks.observe.mockReturnValue(() => {});
  mocks.acquireLease.mockReturnValue(() => {});
  mocks.create.mockResolvedValue({
    runtime: runtime(),
    session: {
      providerSessionId: session.providerSessionId,
      providerSessionPath: session.providerSessionPath,
      name: null,
      firstMessage: null,
      messageCount: 0,
      createdAt: new Date(0),
      modifiedAt: new Date(0),
    },
  });
  mocks.getOrStart.mockResolvedValue(runtime());
  mocks.stopAll.mockResolvedValue(undefined);
  mocks.stopSession.mockResolvedValue(undefined);
  mocks.stopWorkspace.mockResolvedValue(undefined);
  mocks.stopConnection.mockResolvedValue(undefined);
  mocks.registryOptions = null;
});

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("connector daemon command identity", () => {
  it("executes simultaneous deliveries of one command only once", async () => {
    const { journal, timelines } = await openJournal();
    const events: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => events.push(event),
      async () => [],
      journal,
      timelines,
    );

    await Promise.all([
      daemon.handle(command("request-1")),
      daemon.handle(command("request-2")),
    ]);

    expect(mocks.command).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "response",
        requestId: "request-1",
        success: true,
      }),
      expect.objectContaining({
        type: "response",
        requestId: "request-2",
        success: true,
      }),
    ]);
    await timelines.close();
    await journal.close();
  });

  it("reuses an accepted result after a daemon restart", async () => {
    const { file, journal, timelineDirectory, timelines } = await openJournal();
    const firstEvents: HostConnectorEventPayload[] = [];
    const first = new ConnectorDaemon(
      (event) => firstEvents.push(event),
      async () => [],
      journal,
      timelines,
    );
    await first.handle(command("request-1"));
    await timelines.close();
    await journal.close();

    mocks.getOrStart.mockClear();
    mocks.command.mockClear();
    const restored = await ConnectorStateJournal.open(file);
    const restoredTimelines = await ConnectorTimelineStore.open(
      timelineDirectory,
    );
    const secondEvents: HostConnectorEventPayload[] = [];
    const second = new ConnectorDaemon(
      (event) => secondEvents.push(event),
      async () => [],
      restored,
      restoredTimelines,
    );
    await second.handle(command("request-2"));

    expect(mocks.getOrStart).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
    expect(secondEvents).toEqual([
      expect.objectContaining({
        type: "response",
        requestId: "request-2",
        success: true,
        data: {},
      }),
    ]);
    await restoredTimelines.close();
    await restored.close();
  });

  it("stops journaled sessions that the server no longer authorizes", async () => {
    const { journal, timelines } = await openJournal();
    await journal.recordSession(session);
    const daemon = new ConnectorDaemon(
      vi.fn(),
      async () => [],
      journal,
      timelines,
    );

    await daemon.handle({
      type: "sync",
      connectionEpoch: "connection-1",
      activeSessionIds: [],
    });

    expect(mocks.stopSession).toHaveBeenCalledWith("session");
    expect(journal.sessionIds()).toEqual([]);
    await timelines.close();
    await journal.close();
  });

  it("persists runtime events before forwarding them to a subscriber", async () => {
    const { journal, timelines } = await openJournal();
    const emitted: HostConnectorEventPayload[] = [];
    let observer: ((event: AgentRuntimeEnvelope) => void) | undefined;
    mocks.observe.mockImplementation((value) => {
      observer = value;
      return () => {};
    });
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
    );
    await daemon.handle({
      type: "sync",
      connectionEpoch: "connection-1",
      activeSessionIds: ["session"],
      serverInfo: {
        protocolVersion: 1,
        capabilities: ["session-sync-v1"],
      },
    });
    await daemon.handle({
      type: "request",
      requestId: "subscribe",
      request: {
        type: "subscribe_session",
        subscriptionId: "subscription",
        session,
      },
    });
    emitted.length = 0;
    observer?.({
      epoch: "runtime-ephemeral",
      sequence: 99,
      type: "runtime_event",
      data: { type: "turn_start" },
    });

    expect(emitted).toEqual([]);
    await timelines.flush("session");
    await vi.waitFor(() => {
      expect(emitted).toEqual([
        expect.objectContaining({
          type: "session_event",
          envelope: expect.objectContaining({
            epoch: expect.any(String),
            sequence: 1,
            data: expect.objectContaining({
              type: "turn_start",
              overtchatRecordedAt: expect.any(Number),
            }),
          }),
        }),
      ]);
    });
    await daemon.stop();
    await timelines.close();
    await journal.close();
  });

  it("coalesces consecutive growing turn projections into one durable update", async () => {
    const { journal, timelines } = await openJournal();
    const emitted: HostConnectorEventPayload[] = [];
    let observer: ((event: AgentRuntimeEnvelope) => void) | undefined;
    mocks.observe.mockImplementation((value) => {
      observer = value;
      return () => {};
    });
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
    );
    await daemon.handle({
      type: "sync",
      connectionEpoch: "connection-1",
      activeSessionIds: ["session"],
      serverInfo: { protocolVersion: 1, capabilities: ["session-sync-v1"] },
    });
    await daemon.handle({
      type: "request",
      requestId: "subscribe",
      request: { type: "subscribe_session", subscriptionId: "subscription", session },
    });
    emitted.length = 0;

    for (const content of ["a", "ab", "abc"]) {
      observer?.({
        epoch: "runtime-ephemeral",
        sequence: content.length,
        type: "runtime_event",
        data: {
          type: "overtchat_turn_update",
          turnId: "turn-1",
          messages: [{ role: "assistant", content }],
        },
      });
    }
    await timelines.flush("session");

    await vi.waitFor(() => {
      expect(emitted).toEqual([
        expect.objectContaining({
          type: "session_event",
          envelope: expect.objectContaining({
            sequence: 1,
            data: expect.objectContaining({
              type: "overtchat_turn_update",
              messages: [{ role: "assistant", content: "abc" }],
            }),
          }),
        }),
      ]);
    });
    await daemon.stop();
    await timelines.close();
    await journal.close();
  });

  it("freezes capture before service shutdown can publish a synthetic exit", async () => {
    const { journal, timelines } = await openJournal();
    const order: string[] = [];
    let observer: ((event: AgentRuntimeEnvelope) => void) | undefined;
    let observing = true;
    mocks.observe.mockImplementation((value) => {
      observer = value;
      observing = true;
      return () => {
        observing = false;
        order.push("capture-frozen");
      };
    });
    mocks.stopAll.mockImplementation(async () => {
      order.push("providers-stopped");
      if (observing) {
        observer?.({
          epoch: "runtime-ephemeral",
          sequence: 1,
          type: "snapshot",
          data: { ...mocks.snapshot(), status: "exited" },
        });
      }
    });
    const daemon = new ConnectorDaemon(vi.fn(), async () => [], journal, timelines);
    await daemon.handle({
      type: "request",
      requestId: "open",
      request: { type: "open_session", session },
    });

    await daemon.stop();

    expect(order).toEqual(["capture-frozen", "providers-stopped"]);
    await expect(timelines.sync("session")).resolves.toMatchObject({
      reset: true,
      snapshot: { status: "running" },
    });
    await timelines.close();
    await journal.close();
  });

  it("drains an accepted command before shutting down its stores and runtimes", async () => {
    const { journal, timelines } = await openJournal();
    let finishCommand: (() => void) | undefined;
    mocks.command.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCommand = () => resolve({ queued: true, id: "message-1" });
        }),
    );
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
    );
    const handling = daemon.handle(command("request-1"));
    await vi.waitFor(() => expect(mocks.command).toHaveBeenCalledOnce());

    let stopped = false;
    const stopping = daemon.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(mocks.stopAll).not.toHaveBeenCalled();

    finishCommand?.();
    await handling;
    await stopping;

    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "request-1",
        success: true,
      }),
    );
    expect(journal.commandEntry("message-1")).toMatchObject({
      status: "completed",
      result: { success: true },
    });
    expect(mocks.stopAll).toHaveBeenCalledOnce();
    await timelines.close();
    await journal.close();
  });

  it("bounds shutdown when an accepted provider command never settles", async () => {
    const { journal, timelines } = await openJournal();
    mocks.command.mockReturnValueOnce(new Promise(() => {}));
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
      undefined,
      5,
    );
    const handling = daemon.handle(command("request-1"));
    await vi.waitFor(() => expect(mocks.command).toHaveBeenCalledOnce());

    const stopped = daemon.stop().then(() => true);
    await expect(
      Promise.race([
        stopped,
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
      ]),
    ).resolves.toBe(true);
    await handling;

    expect(journal.commandEntry("message-1")).toMatchObject({
      status: "pending",
    });
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "request-1",
        success: false,
        error: expect.stringContaining("will not replay it automatically"),
      }),
    );
    await timelines.close();
    await journal.close();
  });

  it("rejects a late runtime queue write after journal shutdown", async () => {
    const { file, journal, timelines } = await openJournal();
    await journal.recordSession(session);
    const daemon = new ConnectorDaemon(vi.fn(), async () => [], journal, timelines);
    const saveQueuedMessages = mocks.registryOptions?.saveQueuedMessages;
    expect(saveQueuedMessages).toBeTypeOf("function");

    await daemon.stop();
    await timelines.close();
    await journal.close();
    const persistedBeforeLateWrite = await readFile(file, "utf8");

    await expect(
      saveQueuedMessages?.("session", [
        { id: "late-message", message: "Run later", status: "pending" },
      ]),
    ).rejects.toThrow();

    expect(journal.sessionQueue("session")).toEqual([]);
    await expect(readFile(file, "utf8")).resolves.toBe(
      persistedBeforeLateWrite,
    );
  });

  it("does not let a late open continuation write after shutdown", async () => {
    const { journal, timelines } = await openJournal();
    const started = deferred<ReturnType<typeof runtime>>();
    mocks.getOrStart.mockReturnValueOnce(started.promise);
    mocks.stopAll.mockReturnValueOnce(new Promise(() => {}));
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
      undefined,
      1,
    );
    const handling = daemon.handle({
      type: "request",
      requestId: "open",
      request: { type: "open_session", session },
    });
    await vi.waitFor(() => expect(mocks.getOrStart).toHaveBeenCalledOnce());

    await daemon.stop();
    await timelines.close();
    await journal.close();
    started.resolve(runtime());
    await handling;

    expect(journal.sessionIds()).toEqual([]);
    expect(mocks.stopSession).toHaveBeenCalledWith("session");
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "open",
        success: false,
        error: "The Host Connector is shutting down.",
      }),
    );
  });

  it("does not let a late create continuation write after shutdown", async () => {
    const { journal, timelines } = await openJournal();
    const created = deferred<Awaited<ReturnType<typeof mocks.create>>>();
    mocks.create.mockReturnValueOnce(created.promise);
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
      undefined,
      1,
    );
    const handling = daemon.handle({
      type: "request",
      requestId: "create",
      request: { type: "create_session", sessionId: "session", workspace },
    });
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());

    await daemon.stop();
    await timelines.close();
    await journal.close();
    created.resolve({
      runtime: runtime(),
      session: {
        providerSessionId: session.providerSessionId,
        providerSessionPath: session.providerSessionPath,
        name: null,
        firstMessage: null,
        messageCount: 0,
        createdAt: new Date(0),
        modifiedAt: new Date(0),
      },
    });
    await handling;

    expect(journal.sessionIds()).toEqual([]);
    expect(mocks.stopSession).toHaveBeenCalledWith("session");
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "create",
        success: false,
        error: "The Host Connector is shutting down.",
      }),
    );
  });

  it("discards a subscription that resolves after bounded shutdown", async () => {
    const { journal, timelines } = await openJournal();
    const subscribed = deferred<
      Awaited<ReturnType<ConnectorTimelineStore["subscribe"]>>
    >();
    vi.spyOn(timelines, "subscribe").mockReturnValueOnce(subscribed.promise);
    const unsubscribe = vi.fn();
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
      undefined,
      1,
    );
    const handling = daemon.handle({
      type: "request",
      requestId: "subscribe",
      request: {
        type: "subscribe_session",
        subscriptionId: "subscription",
        session,
      },
    });
    await vi.waitFor(() => expect(timelines.subscribe).toHaveBeenCalledOnce());

    await daemon.stop();
    await timelines.close();
    await journal.close();
    subscribed.resolve({
      sync: {
        reset: true,
        cursor: { epoch: "timeline", sequence: 0 },
        snapshot: mocks.snapshot(),
      },
      unsubscribe,
    });
    await handling;

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.acquireLease).not.toHaveBeenCalled();
    expect(
      (Reflect.get(daemon, "subscriptions") as Map<string, unknown>).size,
    ).toBe(0);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "subscribe",
        success: false,
        error: "The Host Connector is shutting down.",
      }),
    );
  });

  it("releases live subscribers when timeline persistence becomes fatal", async () => {
    const { journal, timelines } = await openJournal();
    let observer: ((event: AgentRuntimeEnvelope) => void) | undefined;
    const releaseRuntime = vi.fn();
    mocks.observe.mockImplementation((value) => {
      observer = value;
      return () => {};
    });
    mocks.acquireLease.mockReturnValue(releaseRuntime);
    const fail = vi.fn();
    const daemon = new ConnectorDaemon(
      vi.fn(),
      async () => [],
      journal,
      timelines,
      fail,
    );
    await daemon.handle({
      type: "sync",
      connectionEpoch: "connection-1",
      activeSessionIds: ["session"],
      serverInfo: { protocolVersion: 1, capabilities: ["session-sync-v1"] },
    });
    await daemon.handle({
      type: "request",
      requestId: "subscribe",
      request: { type: "subscribe_session", subscriptionId: "subscription", session },
    });
    vi.spyOn(timelines, "commit").mockRejectedValueOnce(
      new Error("timeline fsync failed"),
    );

    observer?.({
      epoch: "runtime-ephemeral",
      sequence: 1,
      type: "runtime_event",
      data: { type: "turn_start" },
    });

    await vi.waitFor(() => expect(releaseRuntime).toHaveBeenCalledOnce());
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: "timeline fsync failed" }),
    );
    await daemon.handle({
      type: "request",
      requestId: "unsubscribe",
      request: { type: "unsubscribe_session", subscriptionId: "subscription" },
    });
    expect(releaseRuntime).toHaveBeenCalledOnce();
    await daemon.stop().catch(() => {});
    await timelines.close();
    await journal.close();
  });

  it("does not retain a replaced subscription when resubscribe fails", async () => {
    const { journal, timelines } = await openJournal();
    const releaseRuntime = vi.fn();
    mocks.acquireLease.mockReturnValue(releaseRuntime);
    const daemon = new ConnectorDaemon(vi.fn(), async () => [], journal, timelines);
    await daemon.handle({
      type: "request",
      requestId: "subscribe-1",
      request: { type: "subscribe_session", subscriptionId: "subscription", session },
    });
    mocks.getOrStart.mockRejectedValueOnce(new Error("provider unavailable"));

    await daemon.handle({
      type: "request",
      requestId: "subscribe-2",
      request: { type: "subscribe_session", subscriptionId: "subscription", session },
    });
    await daemon.handle({
      type: "request",
      requestId: "unsubscribe",
      request: { type: "unsubscribe_session", subscriptionId: "subscription" },
    });

    expect(releaseRuntime).toHaveBeenCalledOnce();
    await daemon.stop();
    await timelines.close();
    await journal.close();
  });

  it("evicts an exited runtime timeline after its last subscriber leaves", async () => {
    const { journal, timelines } = await openJournal();
    const daemon = new ConnectorDaemon(vi.fn(), async () => [], journal, timelines);
    await daemon.handle({
      type: "request",
      requestId: "subscribe",
      request: { type: "subscribe_session", subscriptionId: "subscription", session },
    });
    const runtime = await mocks.getOrStart.mock.results[0]!.value;

    await mocks.registryOptions?.runtimeExited?.("session", runtime);
    await vi.waitFor(() => {
      const captures = Reflect.get(daemon, "captures") as Map<string, unknown>;
      expect(captures.has("session")).toBe(false);
    });
    expect(
      (Reflect.get(timelines, "states") as Map<string, unknown>).has("session"),
    ).toBe(true);

    await daemon.handle({
      type: "request",
      requestId: "unsubscribe",
      request: { type: "unsubscribe_session", subscriptionId: "subscription" },
    });

    await vi.waitFor(() => {
      expect(
        (Reflect.get(timelines, "states") as Map<string, unknown>).has("session"),
      ).toBe(false);
    });
    await daemon.stop();
    await timelines.close();
    await journal.close();
  });

  it("keeps journal discovery intact if bulk timeline deletion fails", async () => {
    const { journal, timelines } = await openJournal();
    await journal.recordSession(session);
    vi.spyOn(timelines, "deleteSession").mockRejectedValueOnce(
      new Error("timeline disk failed"),
    );
    const emitted: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => emitted.push(event),
      async () => [],
      journal,
      timelines,
    );

    await daemon.handle({
      type: "request",
      requestId: "stop-workspace",
      request: { type: "stop_workspace", workspaceId: "workspace" },
    });

    expect(journal.sessionIds()).toEqual(["session"]);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "response",
        requestId: "stop-workspace",
        success: false,
        error: "timeline disk failed",
      }),
    );
    await timelines.close();
    await journal.close();
  });
});
