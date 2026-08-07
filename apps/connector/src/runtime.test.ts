import { describe, expect, it, vi } from "vitest";
import {
  HOST_CONNECTOR_PROTOCOL_MIN_VERSION,
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  isHostConnectorProtocolVersion,
  type HostConnectorEvent,
} from "@overtchat/agent-bridge";
import { ConnectorRuntime } from "./runtime.js";

async function waitForExit(
  events: HostConnectorEvent[],
  processId: string,
): Promise<Extract<HostConnectorEvent, { type: "exit" }>> {
  await vi.waitFor(() => {
    expect(
      events.some(
        (event) => event.type === "exit" && event.processId === processId,
      ),
    ).toBe(true);
  });
  return events.find(
    (event): event is Extract<HostConnectorEvent, { type: "exit" }> =>
      event.type === "exit" && event.processId === processId,
  )!;
}

describe("connector process runtime", () => {
  it("bridges stdin, stdout, and process exit for local commands", async () => {
    const events: HostConnectorEvent[] = [];
    const runtime = new ConnectorRuntime((event) => events.push(event));
    const processId = "local-echo";

    await runtime.handle({
      type: "spawn",
      processId,
      target: { transport: "local" },
      launch: {
        command: process.execPath,
        args: ["-e", "process.stdin.pipe(process.stdout)"],
      },
    });
    await runtime.handle({
      type: "stdin",
      processId,
      data: Buffer.from("hello connector").toString("base64"),
    });
    await runtime.handle({ type: "stdin_end", processId });

    expect(await waitForExit(events, processId)).toMatchObject({ code: 0 });
    const stdout = events
      .map((event) =>
        event.type === "stdout" && event.processId === processId
          ? Buffer.from(event.data, "base64").toString()
          : "",
      )
      .join("");
    expect(stdout).toBe("hello connector");
    runtime.stop();
  });

  it("loads the local login environment without leaking startup stdout", async () => {
    const events: HostConnectorEvent[] = [];
    const runtime = new ConnectorRuntime((event) => events.push(event));
    const processId = "local-login";

    await runtime.handle({
      type: "spawn",
      processId,
      target: { transport: "local" },
      launch: {
        command: "printf",
        args: ["%s", "login path works"],
      },
    });

    expect(await waitForExit(events, processId)).toMatchObject({ code: 0 });
    expect(
      events
        .map((event) =>
          event.type === "stdout" && event.processId === processId
            ? Buffer.from(event.data, "base64").toString()
            : "",
        )
        .join(""),
    ).toBe("login path works");
  });

  it("fails stale server process IDs after a connector restart", async () => {
    const events: HostConnectorEvent[] = [];
    const runtime = new ConnectorRuntime((event) => events.push(event));

    await runtime.handle({
      type: "sync",
      processIds: ["process-from-old-connector"],
    });

    expect(events).toEqual([
      {
        type: "exit",
        processId: "process-from-old-connector",
        code: null,
        signal: null,
        error: "The Host Connector restarted while the agent was running.",
      },
    ]);
  });

  it("reports invalid SSH aliases as process failures", async () => {
    const events: HostConnectorEvent[] = [];
    const runtime = new ConnectorRuntime((event) => events.push(event));

    await runtime.handle({
      type: "spawn",
      processId: "invalid-ssh",
      target: { transport: "ssh", alias: "user@host" },
      launch: { command: "omp" },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "exit",
        processId: "invalid-ssh",
        error: "Invalid SSH host alias.",
      }),
    ]);
  });
});

describe("connector protocol validation", () => {
  it("accepts supported commands and protocol versions", () => {
    expect(
      isHostConnectorCommand({
        type: "spawn",
        processId: "process",
        target: { transport: "ssh", alias: "devbox" },
        launch: {
          command: "omp",
          args: ["--mode", "rpc"],
          env: { OVERTCHAT: "1" },
        },
      }),
    ).toBe(true);
    expect(
      isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_MIN_VERSION),
    ).toBe(true);
    expect(
      isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_VERSION),
    ).toBe(true);
  });

  it("rejects malformed commands and unsupported protocols", () => {
    expect(
      isHostConnectorCommand({
        type: "spawn",
        processId: "process",
        target: { transport: "ssh" },
        launch: { command: "omp" },
      }),
    ).toBe(false);
    expect(
      isHostConnectorCommand({
        type: "kill",
        processId: "process",
        signal: "NOT_A_SIGNAL",
      }),
    ).toBe(false);
    expect(
      isHostConnectorCommand({
        type: "spawn",
        processId: "process",
        target: { transport: "local" },
        launch: {
          command: "omp",
          env: { "INVALID-NAME": "value" },
        },
      }),
    ).toBe(false);
    expect(
      isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_VERSION + 1),
    ).toBe(false);
  });
});
