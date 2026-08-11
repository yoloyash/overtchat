import { describe, expect, it, vi } from "vitest";
import type {
  AgentDaemonSessionDescriptor,
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

    expect(
      broker.acceptBatch("connector", "daemon-epoch", [
        response(1, request.requestId, { snapshot: "ready" }),
      ]),
    ).toEqual({ connectorEpoch: "daemon-epoch", acknowledgedSequence: 1 });
    await expect(pending).resolves.toEqual({ snapshot: "ready" });
  });

  it("acknowledges duplicate transport events without applying them twice", async () => {
    const commands: HostConnectorCommand[] = [];
    const broker = new HostConnectorBroker();
    broker.register("connector", [], (command) => commands.push(command));
    const pending = broker.request("connector", { type: "list_ssh_hosts" });
    const request = commands.at(-1);
    if (request?.type !== "request") throw new Error("missing request");
    const event = response(1, request.requestId, []);

    broker.acceptBatch("connector", "daemon-epoch", [event]);
    broker.acceptBatch("connector", "daemon-epoch", [event]);

    await expect(pending).resolves.toEqual([]);
    expect(
      broker.acceptBatch("connector", "daemon-epoch", [event]),
    ).toEqual({ connectorEpoch: "daemon-epoch", acknowledgedSequence: 1 });
  });

  it("tracks overlapping connector epochs independently", () => {
    const broker = new HostConnectorBroker();

    expect(
      broker.acceptBatch("connector", "epoch-a", [
        response(1, "request-a", null),
      ]),
    ).toEqual({ connectorEpoch: "epoch-a", acknowledgedSequence: 1 });
    expect(
      broker.acceptBatch("connector", "epoch-b", [
        response(1, "request-b", null),
      ]),
    ).toEqual({ connectorEpoch: "epoch-b", acknowledgedSequence: 1 });
    expect(
      broker.acceptBatch("connector", "epoch-a", [
        response(2, "request-a2", null),
      ]),
    ).toEqual({ connectorEpoch: "epoch-a", acknowledgedSequence: 2 });
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
    );
    const request = commands.at(-1);
    if (request?.type !== "request") throw new Error("missing request");
    broker.acceptBatch("connector", "daemon-epoch", [
      response(1, request.requestId, { subscribed: true }),
    ]);
    const unsubscribe = await subscribed;
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
    broker.acceptBatch("connector", "daemon-epoch", [event]);
    broker.acceptBatch("connector", "daemon-epoch", [event]);
    broker.acceptBatch("connector", "daemon-epoch", [
      {
        ...event,
        sequence: 3,
      },
    ]);

    expect(received).toEqual([1]);
    unsubscribe();
  });
});
