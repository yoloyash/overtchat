import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  ConnectorProcessLaunch,
  ConnectorTarget,
  HostConnectorCommand,
  HostConnectorEvent,
} from "@overtchat/agent-bridge";
import {
  buildSshRemoteCommand,
  listSshHosts,
  sshSpawnArgs,
} from "./ssh.js";

type Emit = (event: HostConnectorEvent) => void;

export class ConnectorRuntime {
  private readonly processes = new Map<
    string,
    ChildProcessWithoutNullStreams
  >();

  constructor(private readonly emit: Emit) {}

  async handle(command: HostConnectorCommand): Promise<void> {
    switch (command.type) {
      case "sync":
        this.sync(command.processIds);
        return;
      case "spawn":
        this.spawn(command.processId, command.target, command.launch);
        return;
      case "stdin":
        this.processes
          .get(command.processId)
          ?.stdin.write(Buffer.from(command.data, "base64"));
        return;
      case "stdin_end":
        this.processes.get(command.processId)?.stdin.end();
        return;
      case "kill":
        this.processes.get(command.processId)?.kill(command.signal);
        return;
      case "request":
        await this.request(command.requestId, command.request);
    }
  }

  stop(): void {
    for (const child of this.processes.values()) child.kill("SIGTERM");
  }

  private sync(activeProcessIds: string[]): void {
    const active = new Set(activeProcessIds);
    for (const [id, child] of this.processes) {
      if (!active.has(id)) child.kill("SIGTERM");
    }
    for (const id of active) {
      if (!this.processes.has(id)) {
        this.emit({
          type: "exit",
          processId: id,
          code: null,
          signal: null,
          error: "The Host Connector restarted while the agent was running.",
        });
      }
    }
  }

  private spawn(
    processId: string,
    target: ConnectorTarget,
    launch: ConnectorProcessLaunch,
  ): void {
    if (this.processes.has(processId)) return;
    let child: ChildProcessWithoutNullStreams;
    try {
      child =
        target.transport === "local"
          ? spawn("/bin/sh", ["-c", buildSshRemoteCommand(launch)], {
              env: process.env,
              stdio: ["pipe", "pipe", "pipe"],
            })
          : spawn("ssh", sshSpawnArgs(target.alias, launch), {
              stdio: ["pipe", "pipe", "pipe"],
            });
    } catch (error) {
      this.emit({
        type: "exit",
        processId,
        code: null,
        signal: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.processes.set(processId, child);
    child.stdout.on("data", (chunk: Buffer) =>
      this.emit({
        type: "stdout",
        processId,
        data: chunk.toString("base64"),
      }),
    );
    child.stderr.on("data", (chunk: Buffer) =>
      this.emit({
        type: "stderr",
        processId,
        data: chunk.toString("base64"),
      }),
    );
    let settled = false;
    const finish = (
      code: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ) => {
      if (settled) return;
      settled = true;
      this.processes.delete(processId);
      this.emit({
        type: "exit",
        processId,
        code,
        signal,
        ...(error ? { error: error.message } : {}),
      });
    };
    child.once("error", (error) => finish(null, null, error));
    child.once("exit", (code, signal) => finish(code, signal));
  }

  private async request(
    requestId: string,
    request: Extract<
      HostConnectorCommand,
      { type: "request" }
    >["request"],
  ): Promise<void> {
    try {
      const data =
        request.type === "list_ssh_hosts" ? await listSshHosts() : null;
      this.emit({ type: "response", requestId, success: true, data });
    } catch (error) {
      this.emit({
        type: "response",
        requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
