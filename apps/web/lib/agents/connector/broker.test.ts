import { describe, expect, it, vi } from "vitest";
import type { HostConnectorCommand } from "@overtchat/agent-bridge";

vi.mock("server-only", () => ({}));

import { HostConnectorBroker } from "./broker";

describe("Host Connector broker", () => {
  it("bridges a virtual process from spawn through stdout and exit", async () => {
    const broker = new HostConnectorBroker();
    const commands: HostConnectorCommand[] = [];
    broker.register("connector", (command) => commands.push(command));

    const processHandle = broker.spawn(
      "connector",
      { transport: "ssh", alias: "macbook" },
      { command: "omp", args: ["--mode", "rpc"] },
    );
    const spawn = commands.find(
      (
        command,
      ): command is Extract<HostConnectorCommand, { type: "spawn" }> =>
        command.type === "spawn",
    );
    expect(spawn).toMatchObject({
      target: { transport: "ssh", alias: "macbook" },
      launch: { command: "omp", args: ["--mode", "rpc"] },
    });

    let stdout = "";
    processHandle.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    processHandle.stdin.write("hello");
    expect(commands.at(-1)).toMatchObject({
      type: "stdin",
      processId: spawn!.processId,
      data: Buffer.from("hello").toString("base64"),
    });

    broker.accept("connector", {
      type: "stdout",
      processId: spawn!.processId,
      data: Buffer.from("world").toString("base64"),
    });
    broker.accept("connector", {
      type: "exit",
      processId: spawn!.processId,
      code: 0,
      signal: null,
    });

    await expect(processHandle.exit).resolves.toEqual({
      code: 0,
      signal: null,
    });
    expect(stdout).toBe("world");
  });

  it("synchronizes active process IDs when a channel reconnects", () => {
    const broker = new HostConnectorBroker();
    const first: HostConnectorCommand[] = [];
    const unregister = broker.register("connector", (command) =>
      first.push(command),
    );
    broker.spawn(
      "connector",
      { transport: "local" },
      { command: "omp" },
    );
    const processId = (
      first.find(
        (
          command,
        ): command is Extract<HostConnectorCommand, { type: "spawn" }> =>
          command.type === "spawn",
      )!
    ).processId;
    unregister();

    const second: HostConnectorCommand[] = [];
    broker.register("connector", (command) => second.push(command));

    expect(second[0]).toEqual({ type: "sync", processIds: [processId] });
  });

  it("validates SSH host discovery responses", async () => {
    const broker = new HostConnectorBroker();
    const commands: HostConnectorCommand[] = [];
    broker.register("connector", (command) => commands.push(command));

    const hostsPromise = broker.listSshHosts("connector");
    const request = commands.find(
      (
        command,
      ): command is Extract<HostConnectorCommand, { type: "request" }> =>
        command.type === "request",
    )!;
    broker.accept("connector", {
      type: "response",
      requestId: request.requestId,
      success: true,
      data: [
        {
          alias: "macbook",
          hostname: "100.64.0.5",
          port: 22,
          username: "yash",
        },
      ],
    });

    await expect(hostsPromise).resolves.toEqual([
      expect.objectContaining({ alias: "macbook" }),
    ]);

    const invalidPromise = broker.listSshHosts("connector");
    const invalidRequest = commands.at(-1) as Extract<
      HostConnectorCommand,
      { type: "request" }
    >;
    broker.accept("connector", {
      type: "response",
      requestId: invalidRequest.requestId,
      success: true,
      data: [{ alias: "broken", port: "22" }],
    });
    await expect(invalidPromise).rejects.toThrow("invalid SSH host list");
  });

  it("rejects process creation while the connector is offline", () => {
    const broker = new HostConnectorBroker();

    expect(() =>
      broker.spawn(
        "offline",
        { transport: "local" },
        { command: "omp" },
      ),
    ).toThrow("Host Connector is offline");
  });
});
