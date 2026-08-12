import { describe, expect, it, vi } from "vitest";
import type {
  AgentDaemonSessionDescriptor,
  AgentRuntimeSnapshot,
  HostConnectorCommand,
  HostConnectorEvent,
} from "@overtchat/agent-bridge";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/agentConnections", () => ({
  updateAgentSessionMetadata: vi.fn(),
}));

import { HostConnectorBroker } from "./broker";

const session: AgentDaemonSessionDescriptor = {
  connectionId: "connection",
  workspaceId: "workspace",
  provider: "codex",
  target: { transport: "local", shellMode: "interactive" },
  executable: "codex",
  cwd: "/workspace",
  sessionId: "session",
  providerSessionId: "thread",
  providerSessionPath: "/thread.jsonl",
};

const runtimeSnapshot: AgentRuntimeSnapshot = {
  sessionId: "session",
  provider: "codex",
  capabilities: { steer: true },
  status: "idle",
  activeTurn: null,
  state: {},
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
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  },
  queuedMessages: [],
};

function response(
  sequence: number,
  requestId: string,
  data: unknown,
): HostConnectorEvent {
  return {
    sequence,
    payload: { type: "response", requestId, success: true, data },
  };
}

describe("host connector daemon broker", () => {
  it("starts an exact connection epoch and resolves agent-level requests", async () => {
    const commands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", ["session"], (command) => commands.push(command));

    expect(commands[0]).toMatchObject({
      type: "sync",
      activeSessionIds: ["session"],
    });
    const pending = broker.request("connector", { type: "open_session", session });
    const request = commands.at(-1);
    expect(request).toMatchObject({
      type: "request",
      request: { type: "open_session" },
    });
    if (request?.type !== "request") throw new Error("missing request");

    await expect(
      broker.acceptBatch("connector", "daemon-epoch", [
        response(1, request.requestId, { snapshot: "ready" }),
      ]),
    ).resolves.toEqual({
      connectorEpoch: "daemon-epoch",
      acknowledgedSequence: 1,
    });
    await expect(pending).resolves.toEqual({ snapshot: "ready" });
  });

  it("replays ledger-backed session commands across connector replacement", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const secondCommands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register(
      "connector",
      [],
      (command) => firstCommands.push(command),
      ["command-wal-v1"],
    );
    const pending = broker.request("connector", {
      type: "session_command",
      commandId: "command-1",
      clientMessageId: "message-1",
      session,
      command: {
        type: "queue",
        message: "Run tests",
        clientMessageId: "message-1",
      },
    });
    const original = firstCommands.at(-1);
    if (
      original?.type !== "request" ||
      original.request.type !== "session_command"
    ) {
      throw new Error("missing original session command");
    }

    broker.register(
      "connector",
      [],
      (command) => secondCommands.push(command),
      ["command-wal-v1"],
    );
    const replay = secondCommands.at(-1);
    if (replay?.type !== "request") {
      throw new Error("missing replayed session command");
    }

    expect(secondCommands[0]?.type).toBe("sync");
    expect(replay.requestId).toBe(original.requestId);
    expect(replay.request).toEqual(original.request);
    expect(replay.request).toMatchObject({
      type: "session_command",
      commandId: "command-1",
      clientMessageId: "message-1",
      command: { clientMessageId: "message-1" },
    });
    await broker.acceptBatch("connector", "replacement-epoch", [
      response(1, replay.requestId, { queuedMessages: [] }),
    ]);
    await expect(pending).resolves.toEqual({ queuedMessages: [] });
  });

  it("rejects a pending session command when the replacement lacks a WAL", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const replacementCommands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register(
      "connector",
      [],
      (command) => firstCommands.push(command),
      ["command-wal-v1"],
    );
    const pending = broker.request("connector", {
      type: "session_command",
      commandId: "command-1",
      session,
      command: { type: "prompt", message: "Run tests" },
    });
    const rejected = expect(pending).rejects.toThrow(
      "command outcome is unknown",
    );

    broker.register("connector", [], (command) =>
      replacementCommands.push(command),
    );

    await rejected;
    expect(firstCommands.at(-1)?.type).toBe("request");
    expect(replacementCommands).toHaveLength(1);
    expect(replacementCommands[0]?.type).toBe("sync");
  });

  it("does not replay a command originally sent to a connector without a WAL", async () => {
    const replacementCommands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", [], () => {});
    const pending = broker.request("connector", {
      type: "session_command",
      commandId: "command-1",
      session,
      command: { type: "prompt", message: "Run tests" },
    });
    const rejected = expect(pending).rejects.toThrow(
      "command outcome is unknown",
    );

    broker.register(
      "connector",
      [],
      (command) => replacementCommands.push(command),
      ["command-wal-v1"],
    );

    await rejected;
    expect(replacementCommands).toHaveLength(1);
    expect(replacementCommands[0]?.type).toBe("sync");
  });

  it("replays a WAL-backed command after the disconnect grace expires", async () => {
    vi.useFakeTimers();
    try {
      const originalCommands: HostConnectorCommand[] = [];
      const replacementCommands: HostConnectorCommand[] = [];
      const broker = new HostConnectorBroker(100);
      const unregister = broker.register(
        "connector",
        [],
        (command) => originalCommands.push(command),
        ["command-wal-v1"],
      );
      const pending = broker.request("connector", {
        type: "session_command",
        commandId: "command-1",
        session,
        command: { type: "prompt", message: "Run tests" },
      });
      const original = originalCommands.at(-1);
      if (original?.type !== "request") {
        throw new Error("missing original command");
      }

      unregister();
      await vi.advanceTimersByTimeAsync(101);
      broker.register(
        "connector",
        [],
        (command) => replacementCommands.push(command),
        ["command-wal-v1"],
      );
      const replay = replacementCommands.at(-1);
      if (replay?.type !== "request") {
        throw new Error("missing replayed command");
      }

      expect(replay.requestId).toBe(original.requestId);
      expect(replay.request).toEqual(original.request);
      await broker.acceptBatch("connector", "replacement-epoch", [
        response(1, replay.requestId, { accepted: true }),
      ]);
      await expect(pending).resolves.toEqual({ accepted: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects reads and subscriptions when the disconnect grace expires", async () => {
    vi.useFakeTimers();
    try {
      const broker = new HostConnectorBroker(100);
      const unregister = broker.register("connector", ["session"], () => {});
      const read = broker.request("connector", { type: "list_ssh_hosts" });
      const subscribed = broker.subscribeSession(
        "connector",
        session,
        undefined,
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      const readRejected = expect(read).rejects.toThrow(
        "Host Connector is offline",
      );
      const subscriptionRejected = expect(subscribed).rejects.toThrow(
        "Host Connector is offline",
      );

      unregister();
      await vi.advanceTimersByTimeAsync(101);

      await Promise.all([readRejected, subscriptionRejected]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an unknown outcome when a WAL-backed command times out", async () => {
    vi.useFakeTimers();
    try {
      const broker = new HostConnectorBroker();
      broker.register("connector", [], () => {}, ["command-wal-v1"]);
      const pending = broker.request("connector", {
        type: "session_command",
        commandId: "command-1",
        session,
        command: { type: "prompt", message: "Run tests" },
      });
      const rejected = expect(pending).rejects.toThrow(
        "command outcome is unknown; inspect the session before retrying",
      );

      await vi.advanceTimersByTimeAsync(180_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects pending reads and non-idempotent operations on replacement", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const secondCommands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", [], (command) => firstCommands.push(command));
    const read = broker.request("connector", { type: "list_ssh_hosts" });
    const create = broker.request("connector", {
      type: "create_session",
      sessionId: "new-session",
      workspace: session,
    });
    const readRejected = expect(read).rejects.toThrow(
      "reconnected before the request completed",
    );
    const createRejected = expect(create).rejects.toThrow(
      "reconnected before the request completed",
    );

    broker.register("connector", [], (command) => secondCommands.push(command));

    await Promise.all([readRejected, createRejected]);
    expect(secondCommands).toHaveLength(1);
    expect(secondCommands[0]?.type).toBe("sync");
  });

  it("rejects and removes a replay when the replacement send fails", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const secondCommands: HostConnectorCommand[] = [];
    const thirdCommands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register(
      "connector",
      [],
      (command) => firstCommands.push(command),
      ["command-wal-v1"],
    );
    const pending = broker.request("connector", {
      type: "session_command",
      commandId: "command-1",
      clientMessageId: "message-1",
      session,
      command: {
        type: "queue",
        message: "Run tests",
        clientMessageId: "message-1",
      },
    });
    const replayFailure = new Error("replacement send failed");
    const rejected = expect(pending).rejects.toBe(replayFailure);

    broker.register(
      "connector",
      [],
      (command) => {
        secondCommands.push(command);
        if (command.type === "request") throw replayFailure;
      },
      ["command-wal-v1"],
    );

    await rejected;
    expect(secondCommands.map((command) => command.type)).toEqual([
      "sync",
      "request",
    ]);
    broker.register("connector", [], (command) => thirdCommands.push(command));
    expect(thirdCommands).toHaveLength(1);
    expect(thirdCommands[0]?.type).toBe("sync");
  });

  it("acknowledges duplicate transport events without applying them twice", async () => {
    const commands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", [], (command) => commands.push(command));
    const pending = broker.request("connector", { type: "list_ssh_hosts" });
    const request = commands.at(-1);
    if (request?.type !== "request") throw new Error("missing request");
    const event = response(1, request.requestId, []);

    await broker.acceptBatch("connector", "daemon-epoch", [event]);
    await broker.acceptBatch("connector", "daemon-epoch", [event]);

    await expect(pending).resolves.toEqual([]);
    await expect(
      broker.acceptBatch("connector", "daemon-epoch", [event]),
    ).resolves.toEqual({
      connectorEpoch: "daemon-epoch",
      acknowledgedSequence: 1,
    });
  });

  it("acknowledges each connector epoch at the delivered batch tail", async () => {
    const broker = new HostConnectorBroker();

    await expect(
      broker.acceptBatch("connector", "epoch-a", [
        response(1, "request-a", null),
      ]),
    ).resolves.toEqual({ connectorEpoch: "epoch-a", acknowledgedSequence: 1 });
    await expect(
      broker.acceptBatch("connector", "epoch-b", [
        response(1, "request-b", null),
      ]),
    ).resolves.toEqual({ connectorEpoch: "epoch-b", acknowledgedSequence: 1 });
    await expect(
      broker.acceptBatch("connector", "epoch-a", [
        response(2, "request-a2", null),
      ]),
    ).resolves.toEqual({ connectorEpoch: "epoch-a", acknowledgedSequence: 2 });
  });

  it("accepts a high sequence after the web broker restarts", async () => {
    const restarted = new HostConnectorBroker();

    await expect(
      restarted.acceptBatch("connector", "durable-connector-epoch", [
        response(26_618, "stale-request", null),
        response(26_619, "stale-request-2", null),
      ]),
    ).resolves.toEqual({
      connectorEpoch: "durable-connector-epoch",
      acknowledgedSequence: 26_619,
    });
  });

  it("rejects gaps inside one delivered batch", async () => {
    const broker = new HostConnectorBroker();

    await expect(
      broker.acceptBatch("connector", "daemon-epoch", [
        response(4, "request-a", null),
        response(6, "request-b", null),
      ]),
    ).rejects.toThrow("not contiguous");
  });

  it("deduplicates session timeline events by daemon epoch and sequence", async () => {
    const commands: HostConnectorCommand[] = [];
    const received: number[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", ["session"], (command) => commands.push(command));
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      (envelope) => received.push(envelope.sequence),
      vi.fn(),
      vi.fn(),
    );
    const request = commands.at(-1);
    if (request?.type !== "request") throw new Error("missing request");
    await broker.acceptBatch("connector", "daemon-epoch", [
      response(1, request.requestId, { subscribed: true }),
    ]);
    const { unsubscribe } = await subscribed;
    const event: HostConnectorEvent = {
      sequence: 2,
      payload: {
        type: "session_event",
        subscriptionId:
          request.request.type === "subscribe_session"
            ? request.request.subscriptionId
            : "missing",
        sessionId: "session",
        envelope: {
          epoch: "runtime-epoch",
          sequence: 1,
          type: "runtime_event",
          data: { type: "turn_start" },
        },
      },
    };
    await broker.acceptBatch("connector", "daemon-epoch", [event]);
    await broker.acceptBatch("connector", "daemon-epoch", [event]);
    await broker.acceptBatch("connector", "daemon-epoch", [
      {
        ...event,
        sequence: 3,
      },
    ]);

    expect(received).toEqual([1]);
    unsubscribe();
  });

  it("advances across legacy private-snapshot gaps before reconnecting", async () => {
    const commands: HostConnectorCommand[] = [];
    const received: number[] = [];
    const broker = new HostConnectorBroker(1_000);
    const unregister = broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      (envelope) => received.push(envelope.sequence),
      vi.fn(),
      vi.fn(),
    );
    const initial = commands.at(-1);
    if (
      initial?.type !== "request" ||
      initial.request.type !== "subscribe_session"
    ) {
      throw new Error("missing initial subscription");
    }
    await broker.acceptBatch("connector", "transport", [
      response(1, initial.requestId, { subscribed: true }),
    ]);
    const subscription = await subscribed;
    await broker.acceptBatch("connector", "transport", [
      {
        sequence: 2,
        payload: {
          type: "session_event",
          subscriptionId: initial.request.subscriptionId,
          sessionId: "session",
          envelope: {
            epoch: "legacy-runtime",
            sequence: 1,
            type: "snapshot",
            data: runtimeSnapshot,
          },
        },
      },
      {
        sequence: 3,
        payload: {
          type: "session_event",
          subscriptionId: initial.request.subscriptionId,
          sessionId: "session",
          envelope: {
            epoch: "legacy-runtime",
            sequence: 3,
            type: "runtime_event",
            data: { type: "turn_start" },
          },
        },
      },
    ]);
    expect(received).toEqual([1, 3]);
    unregister();

    broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
    );
    await vi.waitFor(() => {
      expect(
        commands.some(
          (command) =>
            command.type === "request" &&
            command.request.type === "subscribe_session" &&
            command.request.after?.sequence === 3,
        ),
      ).toBe(true);
    });
    const reconnect = commands.findLast(
      (command) =>
        command.type === "request" &&
        command.request.type === "subscribe_session" &&
        command.request.after?.sequence === 3,
    );
    if (reconnect?.type !== "request") {
      throw new Error("missing reconnect subscription");
    }
    await broker.acceptBatch("connector", "transport", [
      response(4, reconnect.requestId, { subscribed: true }),
    ]);
    subscription.unsubscribe();
  });

  it("delivers an authoritative sync when the connector channel reconnects", async () => {
    const commands: HostConnectorCommand[] = [];
    const order: string[] = [];
    const synchronize = vi.fn((sync: { cursor: { sequence: number } }) => {
      order.push(`sync:${sync.cursor.sequence}`);
    });
    const broker = new HostConnectorBroker(1_000);
    const unregister = broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
      ["session-sync-v1"],
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      (envelope) => order.push(`runtime:${envelope.sequence}`),
      synchronize,
      vi.fn(),
    );
    const initial = commands.at(-1);
    if (initial?.type !== "request") throw new Error("missing request");
    const initialSync = {
      reset: true as const,
      cursor: { epoch: "runtime-epoch", sequence: 5 },
      snapshot: { ...runtimeSnapshot, status: "running" as const },
    };
    await broker.acceptBatch("connector", "transport", [
      response(1, initial.requestId, {
        subscribed: true,
        sync: initialSync,
      }),
    ]);
    const subscription = await subscribed;
    expect(subscription.sync).toEqual(initialSync);
    expect(subscription.authoritative).toBe(true);
    expect(broker.runtimeStatusForSession("session")).toBe("running");
    unregister();

    broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
      ["session-sync-v1"],
    );
    await vi.waitFor(() => {
      expect(
        commands.some(
          (command) =>
            command.type === "request" &&
            command.request.type === "subscribe_session" &&
            command.request.after?.sequence === 5,
        ),
      ).toBe(true);
    });
    const reconnect = commands.findLast(
      (command) =>
        command.type === "request" &&
        command.request.type === "subscribe_session" &&
        command.request.after?.sequence === 5,
    );
    if (reconnect?.type !== "request") throw new Error("missing reconnect");
    if (reconnect.request.type !== "subscribe_session") {
      throw new Error("missing reconnect subscription");
    }
    await broker.acceptBatch("connector", "transport", [
      {
        sequence: 2,
        payload: {
          type: "session_event",
          subscriptionId: reconnect.request.subscriptionId,
          sessionId: "session",
          envelope: {
            epoch: "runtime-epoch",
            sequence: 8,
            type: "runtime_event",
            data: { type: "turn_end" },
          },
        },
      },
    ]);
    expect(order).toEqual([]);
    const reconnectSync = {
      reset: false as const,
      cursor: { epoch: "runtime-epoch", sequence: 7 },
      events: [
        {
          epoch: "runtime-epoch",
          sequence: 6,
          type: "snapshot" as const,
          data: { ...runtimeSnapshot, status: "running" as const },
        },
        {
          epoch: "runtime-epoch",
          sequence: 7,
          type: "runtime_event" as const,
          data: { type: "overtchat_status", status: "exited" },
        },
      ],
    };
    await broker.acceptBatch("connector", "transport", [
      response(3, reconnect.requestId, {
        subscribed: true,
        sync: reconnectSync,
      }),
    ]);
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledWith(reconnectSync));
    expect(order).toEqual(["sync:7", "runtime:8"]);
    expect(broker.runtimeStatusForSession("session")).toBe("exited");
    subscription.unsubscribe();
  });

  it("rejects an initial subscription when its connector is superseded", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const secondCommands: HostConnectorCommand[] = [];
    const subscriber = vi.fn();
    const synchronize = vi.fn();
    const broker = new HostConnectorBroker(1_000);
    broker.register(
      "connector",
      ["session"],
      (command) => firstCommands.push(command),
      ["session-sync-v1"],
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      subscriber,
      synchronize,
      vi.fn(),
    );
    const initial = firstCommands.at(-1);
    if (
      initial?.type !== "request" ||
      initial.request.type !== "subscribe_session"
    ) {
      throw new Error("missing initial subscription");
    }

    const rejected = expect(subscribed).rejects.toThrow(
      "reconnected before the request completed",
    );
    broker.register(
      "connector",
      ["session"],
      (command) => secondCommands.push(command),
      ["session-sync-v1"],
    );
    await rejected;
    await broker.acceptBatch("connector", "first-transport", [
      response(1, initial.requestId, {
        subscribed: true,
        sync: {
          reset: true,
          cursor: { epoch: "stale-runtime", sequence: 1 },
          snapshot: runtimeSnapshot,
        },
      }),
    ]);

    expect(synchronize).not.toHaveBeenCalled();
    expect(subscriber).not.toHaveBeenCalled();
    expect(
      secondCommands.some(
        (command) =>
          command.type === "request" &&
          command.request.type === "subscribe_session",
      ),
    ).toBe(false);
    expect(secondCommands).toContainEqual(
      expect.objectContaining({
        type: "request",
        request: {
          type: "unsubscribe_session",
          subscriptionId: initial.request.subscriptionId,
        },
      }),
    );
  });

  it("does not return a zombie initial subscription after a mode change", async () => {
    const firstCommands: HostConnectorCommand[] = [];
    const secondCommands: HostConnectorCommand[] = [];
    const disconnect = vi.fn();
    const broker = new HostConnectorBroker(1_000);
    broker.register("connector", ["session"], (command) =>
      firstCommands.push(command),
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      vi.fn(),
      vi.fn(),
      disconnect,
    );
    const initial = firstCommands.at(-1);
    if (
      initial?.type !== "request" ||
      initial.request.type !== "subscribe_session"
    ) {
      throw new Error("missing initial subscription");
    }

    const rejected = expect(subscribed).rejects.toThrow(
      "reconnected before the request completed",
    );
    broker.register(
      "connector",
      ["session"],
      (command) => secondCommands.push(command),
      ["session-sync-v1"],
    );
    await rejected;
    await broker.acceptBatch("connector", "first-transport", [
      response(1, initial.requestId, { subscribed: true }),
    ]);

    expect(disconnect).not.toHaveBeenCalled();
    expect(
      secondCommands.some(
        (command) =>
          command.type === "request" &&
          command.request.type === "subscribe_session",
      ),
    ).toBe(false);
    expect(secondCommands).toContainEqual(
      expect.objectContaining({
        type: "request",
        request: {
          type: "unsubscribe_session",
          subscriptionId: initial.request.subscriptionId,
        },
      }),
    );
  });

  it("releases the connector lease when the initial sync is invalid", async () => {
    const commands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
      ["session-sync-v1"],
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    const request = commands.at(-1);
    if (
      request?.type !== "request" ||
      request.request.type !== "subscribe_session"
    ) {
      throw new Error("missing subscription request");
    }

    await broker.acceptBatch("connector", "transport", [
      response(1, request.requestId, {
        subscribed: true,
        sync: { reset: "not-a-boolean" },
      }),
    ]);

    await expect(subscribed).rejects.toThrow("invalid session sync");
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: "request",
        request: {
          type: "unsubscribe_session",
          subscriptionId: request.request.subscriptionId,
        },
      }),
    );
  });

  it("disconnects a browser stream when connector resubscription fails", async () => {
    const commands: HostConnectorCommand[] = [];
    const disconnect = vi.fn();
    const broker = new HostConnectorBroker(1_000);
    const unregister = broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
      ["session-sync-v1"],
    );
    const subscribed = broker.subscribeSession(
      "connector",
      session,
      undefined,
      vi.fn(),
      vi.fn(),
      disconnect,
    );
    const initial = commands.at(-1);
    if (
      initial?.type !== "request" ||
      initial.request.type !== "subscribe_session"
    ) {
      throw new Error("missing initial subscription");
    }
    await broker.acceptBatch("connector", "transport", [
      response(1, initial.requestId, {
        subscribed: true,
        sync: {
          reset: true,
          cursor: { epoch: "runtime", sequence: 1 },
          snapshot: { sessionId: "session", status: "idle" },
        },
      }),
    ]);
    await subscribed;
    unregister();

    broker.register(
      "connector",
      ["session"],
      (command) => commands.push(command),
      ["session-sync-v1"],
    );
    await vi.waitFor(() => {
      expect(
        commands.some(
          (command) =>
            command.type === "request" &&
            command.request.type === "subscribe_session" &&
            command.request.after?.sequence === 1,
        ),
      ).toBe(true);
    });
    const reconnect = commands.findLast(
      (command) =>
        command.type === "request" &&
        command.request.type === "subscribe_session" &&
        command.request.after?.sequence === 1,
    );
    if (
      reconnect?.type !== "request" ||
      reconnect.request.type !== "subscribe_session"
    ) {
      throw new Error("missing reconnect subscription");
    }

    await broker.acceptBatch("connector", "transport", [
      {
        sequence: 2,
        payload: {
          type: "response",
          requestId: reconnect.requestId,
          success: false,
          error: "could not restore subscription",
        },
      },
    ]);

    await vi.waitFor(() =>
      expect(disconnect).toHaveBeenCalledWith(
        expect.objectContaining({ message: "could not restore subscription" }),
      ),
    );
    expect(commands).toContainEqual(
      expect.objectContaining({
        type: "request",
        request: {
          type: "unsubscribe_session",
          subscriptionId: reconnect.request.subscriptionId,
        },
      }),
    );
  });
});
