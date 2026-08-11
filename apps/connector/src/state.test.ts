import { mkdtemp, rm } from "node:fs/promises";
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
        status: "sending",
      },
    ]);
    await value.recordCommandResult("message-1", {
      success: true,
      data: { queued: true, id: "message-1" },
    });
    await value.close();

    const restored = await ConnectorStateJournal.open(file);
    expect(restored.commandResult("message-1")).toEqual({
      success: true,
      data: { queued: true, id: "message-1" },
    });
    expect(restored.sessionQueue("session")).toEqual([
      {
        id: "message-1",
        message: "Run the tests",
        status: "sending",
      },
    ]);
    await restored.close();
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

  it("removes sessions that are no longer authorized by the server", async () => {
    const { value } = await journal();
    await value.recordSession(session);

    await value.retainSessions(new Set());

    expect(value.sessionIds()).toEqual([]);
    await value.close();
  });
});
