import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDaemonSessionDescriptor } from "@overtchat/agent-bridge";
import { ConnectorStateJournal } from "./state.js";

const directories: string[] = [];

async function journal(): Promise<{
  file: string;
  value: ConnectorStateJournal;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-state-"));
  directories.push(directory);
  const file = path.join(directory, "connector.state.json");
  return { file, value: await ConnectorStateJournal.open(file) };
}

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

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("connector state journal", () => {
  it("restores unacknowledged events with the same transport identity", async () => {
    const { file, value } = await journal();
    const epoch = value.connectorEpoch;
    value.enqueue({
      type: "response",
      requestId: "request-1",
      success: true,
      data: { accepted: true },
    });
    await value.close();

    const restored = await ConnectorStateJournal.open(file);
    expect(restored.connectorEpoch).toBe(epoch);
    expect(restored.eventBatch()).toEqual([
      {
        sequence: 1,
        payload: {
          type: "response",
          requestId: "request-1",
          success: true,
          data: { accepted: true },
        },
      },
    ]);

    await restored.acknowledge({
      connectorEpoch: epoch,
      acknowledgedSequence: 1,
    });
    await restored.close();
    const acknowledged = await ConnectorStateJournal.open(file);
    expect(acknowledged.eventBatch()).toEqual([]);
    await acknowledged.close();
  });

  it("persists accepted command results and pending session queues", async () => {
    const { file, value } = await journal();
    await value.recordSession(session);
    await value.saveSessionQueue("session", [
      {
        id: "message-1",
        message: "Run the tests",
        status: "uncertain",
      },
    ]);
    await expect(
      value.beginCommand("message-1", "session", "a".repeat(64)),
    ).resolves.toEqual({ status: "execute" });
    await value.completeCommand("message-1", "session", "a".repeat(64), {
      success: true,
      data: {
        queued: true,
        id: "message-1",
        snapshot: { queuedMessages: [{ id: "stale-message" }] },
      },
    });
    await value.close();

    const restored = await ConnectorStateJournal.open(file);
    expect(restored.commandEntry("message-1")).toEqual({
      commandId: "message-1",
      sessionId: "session",
      fingerprint: "a".repeat(64),
      status: "completed",
      result: {
        success: true,
        data: { queued: true, id: "message-1" },
      },
    });
    expect(restored.sessionQueue("session")).toEqual([
      {
        id: "message-1",
        message: "Run the tests",
        status: "uncertain",
      },
    ]);
    await restored.close();
  });

  it("rejects late journal mutations as soon as close begins", async () => {
    const { file, value } = await journal();
    await value.recordSession(session);
    await value.saveSessionQueue("session", [
      {
        id: "original-message",
        message: "Keep this state",
        status: "uncertain",
      },
    ]);

    const closing = value.close();

    expect(() =>
      value.enqueue({
        type: "response",
        requestId: "late-response",
        success: true,
        data: null,
      }),
    ).toThrow("state journal is closed");
    await expect(
      value.saveSessionQueue("session", [
        {
          id: "late-message",
          message: "Must not overwrite the journal",
          status: "pending",
        },
      ]),
    ).rejects.toThrow("state journal is closed");
    await expect(
      value.recordSession({ ...session, sessionId: "late-session" }),
    ).rejects.toThrow("state journal is closed");
    await expect(
      value.beginCommand("late-command", "session", "f".repeat(64)),
    ).rejects.toThrow("state journal is closed");
    await expect(value.flush()).rejects.toThrow("state journal is closed");
    await closing;

    const persisted = JSON.parse(await readFile(file, "utf8"));
    expect(persisted.nextEventSequence).toBe(0);
    expect(persisted.commands).toEqual([]);
    expect(persisted.sessions).not.toHaveProperty("late-session");
    expect(persisted.sessions.session.queuedMessages).toEqual([
      {
        id: "original-message",
        message: "Keep this state",
        status: "uncertain",
      },
    ]);
    await expect(value.deleteSession("session")).rejects.toThrow(
      "state journal is closed",
    );
  });

  it("never re-executes a command left pending across a restart", async () => {
    const { file, value } = await journal();
    await value.beginCommand("message-1", "session", "b".repeat(64));
    expect(JSON.parse(await readFile(file, "utf8")).commands).toEqual([
      {
        commandId: "message-1",
        sessionId: "session",
        fingerprint: "b".repeat(64),
        status: "pending",
      },
    ]);
    await value.close();

    const restored = await ConnectorStateJournal.open(file);
    await expect(
      restored.beginCommand("message-1", "session", "b".repeat(64)),
    ).resolves.toEqual({ status: "pending" });
    await expect(
      restored.beginCommand("message-1", "other-session", "b".repeat(64)),
    ).rejects.toThrow("reused for different work");
    await expect(
      restored.beginCommand("message-1", "session", "c".repeat(64)),
    ).rejects.toThrow("reused for different work");
    await restored.close();
  });

  it("does not allow a completed command result to be rewritten", async () => {
    const { value } = await journal();
    const fingerprint = "d".repeat(64);
    await value.beginCommand("message-1", "session", fingerprint);
    await value.completeCommand("message-1", "session", fingerprint, {
      success: true,
      data: { accepted: true },
    });

    await expect(
      value.completeCommand("message-1", "session", fingerprint, {
        success: false,
        error: "replacement",
      }),
    ).rejects.toThrow("already completed");
    expect(value.commandEntry("message-1")).toMatchObject({
      result: { success: true, data: { accepted: true } },
    });
    await value.close();
  });

  it.each([
    { encoding: "compact", space: undefined },
    { encoding: "pretty-printed", space: 2 },
  ])("migrates a $encoding v0.2 transport backlog", async ({ space }) => {
    const { file, value } = await journal();
    await value.close();
    const legacySessionEvent = {
      sequence: 1,
      payload: {
        type: "session_event",
        subscriptionId: "subscription",
        sessionId: "session",
        envelope: {
          epoch: "runtime",
          sequence: 1,
          type: "runtime_event",
          data: { type: "turn_start", text: "x".repeat(10_000) },
        },
      },
    };
    await writeFile(
      file,
      `${JSON.stringify(
        {
          format: 1,
          connectorEpoch: "legacy-epoch",
          nextEventSequence: 3,
          acknowledgedSequence: 0,
          events: [
            legacySessionEvent,
            { ...legacySessionEvent, sequence: 2 },
            {
              sequence: 3,
              payload: {
                type: "response",
                requestId: "request-1",
                success: true,
                data: null,
              },
            },
          ],
          commandResults: [
            [
              "message-1",
              {
                success: true,
                data: {
                  commandResult: { accepted: true },
                  snapshot: {
                    queuedMessages: [{ message: "x".repeat(10_000) }],
                  },
                },
              },
            ],
          ],
          sessions: {
            session: { descriptor: session, queuedMessages: [] },
          },
        },
        null,
        space,
      )}\n`,
    );

    const migrated = await ConnectorStateJournal.open(file);
    expect(migrated.connectorEpoch).not.toBe("legacy-epoch");
    expect(migrated.eventBatch()).toEqual([
      {
        sequence: 1,
        payload: {
          type: "response",
          requestId: "request-1",
          success: true,
          data: null,
        },
      },
    ]);
    expect(migrated.commandEntry("message-1")).toMatchObject({
      sessionId: null,
      fingerprint: null,
      result: { success: true, data: { commandResult: { accepted: true } } },
    });
    await migrated.close();
    const persisted = await readFile(file, "utf8");
    expect(JSON.parse(persisted)).toMatchObject({ format: 2 });
    expect(persisted).not.toContain("x".repeat(10_000));
  });

  it("rejects ambiguous format-2 ledgers with duplicate command identities", async () => {
    const { file, value } = await journal();
    await value.close();
    const state = JSON.parse(await readFile(file, "utf8"));
    state.commands = [
      {
        commandId: "duplicate",
        sessionId: "session",
        fingerprint: "e".repeat(64),
        status: "pending",
      },
      {
        commandId: "duplicate",
        sessionId: "session",
        fingerprint: "e".repeat(64),
        status: "pending",
      },
    ];
    await writeFile(file, JSON.stringify(state, null, 2));

    await expect(ConnectorStateJournal.open(file)).rejects.toThrow(
      "Invalid Host Connector command journal",
    );
  });

  it("rejects a format-2 transport journal with a missing event", async () => {
    const { file, value } = await journal();
    await value.close();
    const state = JSON.parse(await readFile(file, "utf8"));
    state.nextEventSequence = 2;
    state.events = [
      {
        sequence: 2,
        payload: {
          type: "response",
          requestId: "request-2",
          success: true,
          data: null,
        },
      },
    ];
    await writeFile(file, JSON.stringify(state));

    await expect(ConnectorStateJournal.open(file)).rejects.toThrow(
      "Invalid Host Connector event journal",
    );
  });

  it("rejects acknowledgements for a different transport epoch", async () => {
    const { value } = await journal();
    value.enqueue({
      type: "response",
      requestId: "request-1",
      success: true,
      data: null,
    });

    await expect(
      value.acknowledge({
        connectorEpoch: "different-epoch",
        acknowledgedSequence: 1,
      }),
    ).rejects.toThrow("different connector epoch");
    await value.close();
  });

  it("rebases pending events when a legacy server loses its receive cursor", async () => {
    const { file, value } = await journal();
    const originalEpoch = value.connectorEpoch;
    value.enqueue({
      type: "response",
      requestId: "acknowledged-request",
      success: true,
      data: null,
    });
    await value.acknowledge({
      connectorEpoch: originalEpoch,
      acknowledgedSequence: 1,
    });
    value.enqueue({
      type: "response",
      requestId: "pending-request-1",
      success: true,
      data: 1,
    });
    value.enqueue({
      type: "response",
      requestId: "pending-request-2",
      success: true,
      data: 2,
    });

    await expect(
      value.acknowledge({
        connectorEpoch: originalEpoch,
        acknowledgedSequence: 0,
      }),
    ).resolves.toBe("rebased");
    expect(value.connectorEpoch).not.toBe(originalEpoch);
    expect(value.eventBatch()).toEqual([
      {
        sequence: 1,
        payload: {
          type: "response",
          requestId: "pending-request-1",
          success: true,
          data: 1,
        },
      },
      {
        sequence: 2,
        payload: {
          type: "response",
          requestId: "pending-request-2",
          success: true,
          data: 2,
        },
      },
    ]);
    await value.close();

    const restored = await ConnectorStateJournal.open(file);
    expect(restored.connectorEpoch).not.toBe(originalEpoch);
    expect(restored.eventBatch().map((event) => event.sequence)).toEqual([1, 2]);
    await restored.close();
  });

  it("removes sessions and scoped command entries no longer authorized by the server", async () => {
    const { value } = await journal();
    await value.recordSession(session);
    await value.beginCommand("session-command", "session", "f".repeat(64));
    await value.beginCommand("orphan-command", "orphan", "0".repeat(64));

    await value.retainSessions(new Set());

    expect(value.sessionIds()).toEqual([]);
    expect(value.commandEntry("session-command")).toBeUndefined();
    expect(value.commandEntry("orphan-command")).toBeUndefined();
    await value.close();
  });

  it("cleans up an orphan command even when its session was never recorded", async () => {
    const { value } = await journal();
    await value.beginCommand("orphan-command", "orphan", "1".repeat(64));

    await expect(value.deleteSession("orphan")).resolves.toEqual([]);
    expect(value.commandEntry("orphan-command")).toBeUndefined();
    await value.close();
  });
});
