import { describe, expect, it } from "vitest";
import {
  HOST_CONNECTOR_PROTOCOL_VERSION,
  isHostConnectorCommand,
  isHostConnectorProtocolVersion,
} from "@overtchat/agent-bridge";
import { ConnectorProcessHost } from "./runtime.js";

async function outputOf(
  host: ConnectorProcessHost,
  command: string,
  input = "",
): Promise<{ stdout: string; code: number | null }> {
  const child = host.spawn(
    { transport: "local", shellMode: "login" },
    {
      command,
      args: command === process.execPath
        ? ["-e", "process.stdin.pipe(process.stdout)"]
        : ["%s", input],
      shellMode: "login",
    },
  );
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  if (command === process.execPath) child.stdin.end(input);
  else child.stdin.end();
  const exit = await child.exit;
  return { stdout, code: exit.code };
}

describe("connector process host", () => {
  it("owns local process stdin, stdout, and exit", async () => {
    const host = new ConnectorProcessHost();
    await expect(outputOf(host, process.execPath, "hello daemon")).resolves.toEqual({
      stdout: "hello daemon",
      code: 0,
    });
    host.stop();
  });

  it("loads the configured shell environment without startup noise", async () => {
    const host = new ConnectorProcessHost();
    await expect(outputOf(host, "printf", "login works")).resolves.toEqual({
      stdout: "login works",
      code: 0,
    });
    host.stop();
  });
});

describe("connector protocol validation", () => {
  it("uses one exact protocol version and agent-level requests", () => {
    expect(isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_VERSION)).toBe(true);
    expect(isHostConnectorProtocolVersion(HOST_CONNECTOR_PROTOCOL_VERSION + 1)).toBe(false);
    expect(
      isHostConnectorCommand({
        type: "sync",
        connectionEpoch: "web-process-1",
        activeSessionIds: [],
      }),
    ).toBe(true);
    expect(
      isHostConnectorCommand({
        type: "request",
        requestId: "request-1",
        request: { type: "list_ssh_hosts" },
      }),
    ).toBe(true);
  });

  it("rejects commands outside the agent daemon protocol", () => {
    expect(
      isHostConnectorCommand({
        type: "spawn",
        processId: "process",
      }),
    ).toBe(false);
  });
});
