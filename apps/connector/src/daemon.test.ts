import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentDaemonSessionDescriptor,
  HostConnectorCommand,
  HostConnectorEventPayload,
} from "@overtchat/agent-bridge";

const mocks = vi.hoisted(() => ({
  configureProcessSpawner: vi.fn(),
  getOrStart: vi.fn(),
  stopAll: vi.fn(),
  stopSession: vi.fn(),
  command: vi.fn(),
  normalizeCommand: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("@overtchat/agent-runtime")
  >();
  return {
    ...original,
    configureProcessSpawner: mocks.configureProcessSpawner,
    AgentRuntimeRegistry: class {
      getOrStart = mocks.getOrStart;
      stopAll = mocks.stopAll;
      stopSession = mocks.stopSession;
    },
  };
});

import { ConnectorDaemon } from "./daemon.js";
import { ConnectorStateJournal } from "./state.js";

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

async function openJournal(): Promise<{
  file: string;
  journal: ConnectorStateJournal;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "overtchat-daemon-"));
  directories.push(directory);
  const file = path.join(directory, "connector.state.json");
  return { file, journal: await ConnectorStateJournal.open(file) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normalizeCommand.mockImplementation((value) => value);
  mocks.command.mockResolvedValue({ queued: true, id: "message-1" });
  mocks.snapshot.mockReturnValue({
    sessionId: "session",
    status: "running",
    queuedMessages: [
      { id: "message-1", message: "Run the tests", status: "pending" },
    ],
  });
  mocks.getOrStart.mockResolvedValue({
    normalizeCommand: mocks.normalizeCommand,
    command: mocks.command,
    snapshot: mocks.snapshot,
  });
  mocks.stopAll.mockResolvedValue(undefined);
  mocks.stopSession.mockResolvedValue(undefined);
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
    const { journal } = await openJournal();
    const events: HostConnectorEventPayload[] = [];
    const daemon = new ConnectorDaemon(
      (event) => events.push(event),
      async () => [],
      journal,
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
    await journal.close();
  });

  it("reuses an accepted result after a daemon restart", async () => {
    const { file, journal } = await openJournal();
    const firstEvents: HostConnectorEventPayload[] = [];
    const first = new ConnectorDaemon(
      (event) => firstEvents.push(event),
      async () => [],
      journal,
    );
    await first.handle(command("request-1"));
    await journal.close();

    mocks.getOrStart.mockClear();
    mocks.command.mockClear();
    const restored = await ConnectorStateJournal.open(file);
    const secondEvents: HostConnectorEventPayload[] = [];
    const second = new ConnectorDaemon(
      (event) => secondEvents.push(event),
      async () => [],
      restored,
    );
    await second.handle(command("request-2"));

    expect(mocks.getOrStart).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
    expect(secondEvents).toEqual([
      expect.objectContaining({
        type: "response",
        requestId: "request-2",
        success: true,
        data: expect.objectContaining({
          snapshot: expect.objectContaining({
            queuedMessages: [
              expect.objectContaining({ id: "message-1" }),
            ],
          }),
        }),
      }),
    ]);
    await restored.close();
  });

  it("stops journaled sessions that the server no longer authorizes", async () => {
    const { journal } = await openJournal();
    await journal.recordSession(session);
    const daemon = new ConnectorDaemon(
      vi.fn(),
      async () => [],
      journal,
    );

    await daemon.handle({
      type: "sync",
      connectionEpoch: "connection-1",
      activeSessionIds: [],
    });

    expect(mocks.stopSession).toHaveBeenCalledWith("session");
    expect(journal.sessionIds()).toEqual([]);
    await journal.close();
  });
});
