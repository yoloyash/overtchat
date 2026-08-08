import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
        shellMode: "login",
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
        shellMode: "login",
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
    expect(
      events
        .map((event) =>
          event.type === "stderr" && event.processId === processId
            ? Buffer.from(event.data, "base64").toString()
            : "",
        )
        .join(""),
    ).not.toMatch(/job control|terminal process group/iu);
  });

  it("loads interactive-only PATH entries for agent launches", async () => {
    const home = fs.mkdtempSync(
      path.join(os.tmpdir(), "overtchat-connector-shell-"),
    );
    const originalHome = process.env.HOME;
    const originalShell = process.env.SHELL;
    try {
      const tools = path.join(home, "tools");
      fs.mkdirSync(tools);
      fs.writeFileSync(
        path.join(home, ".bash_profile"),
        '. "$HOME/.bashrc"\n',
      );
      fs.writeFileSync(
        path.join(home, ".bashrc"),
        [
          'case "$-" in',
          "  *i*) ;;",
          "  *) return ;;",
          "esac",
          'export PATH="$HOME/tools:$PATH"',
        ].join("\n"),
      );
      const executable = path.join(tools, "overtchat-test-agent");
      fs.writeFileSync(executable, "#!/bin/sh\nprintf 'interactive path works'\n");
      fs.chmodSync(executable, 0o755);
      process.env.HOME = home;
      process.env.SHELL = "/bin/bash";

      const events: HostConnectorEvent[] = [];
      const runtime = new ConnectorRuntime((event) => events.push(event));
      const processId = "interactive-login";
      await runtime.handle({
        type: "spawn",
        processId,
        target: { transport: "local" },
        launch: {
          command: "overtchat-test-agent",
          shellMode: "interactive",
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
      ).toBe("interactive path works");
      runtime.stop();
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = originalShell;
      fs.rmSync(home, { recursive: true, force: true });
    }
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
      launch: { command: "omp", shellMode: "interactive" },
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
          shellMode: "interactive",
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
          shellMode: "interactive",
        },
      }),
    ).toBe(false);
    expect(
      isHostConnectorCommand({
        type: "spawn",
        processId: "process",
        target: { transport: "local" },
        launch: { command: "omp" },
      }),
    ).toBe(false);
    expect(
      isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_VERSION + 1),
    ).toBe(false);
  });
});
