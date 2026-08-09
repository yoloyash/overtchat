import "server-only";
import { PassThrough, Writable } from "node:stream";
import {
  isConnectorSshHost,
  type ConnectorProcessLaunch,
  type ConnectorSshHost,
  type ConnectorTarget,
  type HostConnectorCommand,
  type HostConnectorEvent,
} from "@overtchat/agent-bridge";

const REQUEST_TIMEOUT_MS = 15_000;
const CONNECTOR_DISCONNECT_GRACE_MS = 5_000;
const PROCESS_EXIT_GRACE_MS = 5_000;

export type ConnectorProcessExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

export type ConnectorProcess = {
  stdin: Writable;
  stdout: PassThrough;
  stderr: PassThrough;
  exit: Promise<ConnectorProcessExit>;
  kill(signal?: NodeJS.Signals): boolean;
};

type Channel = {
  send: (command: HostConnectorCommand) => void;
};

type PendingRequest = {
  connectorId: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type ProcessEntry = {
  connectorId: string;
  stdout: PassThrough;
  stderr: PassThrough;
  finish: (exit: ConnectorProcessExit) => void;
};

export class HostConnectorBroker {
  private readonly channels = new Map<string, Channel>();
  private readonly processes = new Map<string, ProcessEntry>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly disconnectGraceMs = CONNECTOR_DISCONNECT_GRACE_MS,
  ) {}

  isOnline(connectorId: string): boolean {
    return this.channels.has(connectorId);
  }

  register(
    connectorId: string,
    send: (command: HostConnectorCommand) => void,
  ): () => void {
    this.clearDisconnectTimer(connectorId);
    const channel = { send };
    this.channels.set(connectorId, channel);
    try {
      send({
        type: "sync",
        processIds: [...this.processes]
          .filter(([, process]) => process.connectorId === connectorId)
          .map(([id]) => id),
      });
    } catch (error) {
      this.channels.delete(connectorId);
      this.scheduleDisconnect(connectorId);
      throw error;
    }
    return () => {
      if (this.channels.get(connectorId) === channel) {
        this.channels.delete(connectorId);
        this.scheduleDisconnect(connectorId);
      }
    };
  }

  spawn(
    connectorId: string,
    target: ConnectorTarget,
    launch: ConnectorProcessLaunch,
  ): ConnectorProcess {
    const processId = crypto.randomUUID();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let settle: (exit: ConnectorProcessExit) => void = () => {};
    const exit = new Promise<ConnectorProcessExit>((resolve) => {
      settle = resolve;
    });
    const finish = (result: ConnectorProcessExit) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      this.processes.delete(processId);
      stdout.end();
      stderr.end();
      settle(result);
    };
    const send = (command: HostConnectorCommand) => {
      const channel = this.channels.get(connectorId);
      if (!channel) throw new Error("The OvertChat Host Connector is offline.");
      channel.send(command);
    };
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        try {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          send({
            type: "stdin",
            processId,
            data: bytes.toString("base64"),
          });
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
      final(callback) {
        try {
          send({ type: "stdin_end", processId });
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    this.processes.set(processId, {
      connectorId,
      stdout,
      stderr,
      finish,
    });
    try {
      send({ type: "spawn", processId, target, launch });
    } catch (error) {
      finish({
        code: null,
        signal: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
    return {
      stdin,
      stdout,
      stderr,
      exit,
      kill: (signal = "SIGTERM") => {
        if (settled) return false;
        try {
          send({ type: "kill", processId, signal });
          if (killTimer) clearTimeout(killTimer);
          killTimer = setTimeout(() => {
            finish({
              code: null,
              signal,
              error: new Error(
                `The Host Connector did not confirm process exit after ${signal}.`,
              ),
            });
          }, PROCESS_EXIT_GRACE_MS);
          killTimer.unref();
          return true;
        } catch (error) {
          finish({
            code: null,
            signal: null,
            error:
              error instanceof Error ? error : new Error(String(error)),
          });
          return false;
        }
      },
    };
  }

  async listSshHosts(connectorId: string): Promise<ConnectorSshHost[]> {
    const value = await this.request(connectorId, { type: "list_ssh_hosts" });
    if (!Array.isArray(value) || !value.every(isConnectorSshHost)) {
      throw new Error("The Host Connector returned an invalid SSH host list.");
    }
    return value;
  }

  accept(connectorId: string, event: HostConnectorEvent): void {
    if (event.type === "response") {
      const pending = this.pending.get(event.requestId);
      if (!pending || pending.connectorId !== connectorId) return;
      clearTimeout(pending.timeout);
      this.pending.delete(event.requestId);
      if (event.success) pending.resolve(event.data);
      else pending.reject(new Error(event.error));
      return;
    }
    const process = this.processes.get(event.processId);
    if (!process || process.connectorId !== connectorId) return;
    if (event.type === "stdout" || event.type === "stderr") {
      const stream = event.type === "stdout" ? process.stdout : process.stderr;
      stream.write(Buffer.from(event.data, "base64"));
      return;
    }
    if (event.type !== "exit") return;
    process.finish({
      code: event.code,
      signal: event.signal,
      ...(event.error ? { error: new Error(event.error) } : {}),
    });
  }

  private clearDisconnectTimer(connectorId: string): void {
    const timer = this.disconnectTimers.get(connectorId);
    if (!timer) return;
    clearTimeout(timer);
    this.disconnectTimers.delete(connectorId);
  }

  private scheduleDisconnect(connectorId: string): void {
    this.clearDisconnectTimer(connectorId);
    const timer = setTimeout(() => {
      if (
        this.disconnectTimers.get(connectorId) !== timer ||
        this.channels.has(connectorId)
      ) {
        return;
      }
      this.disconnectTimers.delete(connectorId);
      const error = new Error(
        "The OvertChat Host Connector disconnected while the agent was running.",
      );
      for (const process of [...this.processes.values()]) {
        if (process.connectorId !== connectorId) continue;
        process.finish({ code: null, signal: null, error });
      }
      for (const [requestId, request] of this.pending) {
        if (request.connectorId !== connectorId) continue;
        clearTimeout(request.timeout);
        this.pending.delete(requestId);
        request.reject(error);
      }
    }, this.disconnectGraceMs);
    timer.unref();
    this.disconnectTimers.set(connectorId, timer);
  }

  private request(
    connectorId: string,
    request: Extract<
      HostConnectorCommand,
      { type: "request" }
    >["request"],
  ): Promise<unknown> {
    const channel = this.channels.get(connectorId);
    if (!channel) {
      return Promise.reject(
        new Error("The OvertChat Host Connector is offline."),
      );
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("Timed out waiting for the Host Connector."));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        connectorId,
        resolve,
        reject,
        timeout,
      });
      try {
        channel.send({ type: "request", requestId, request });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

const globalForHostConnector = globalThis as typeof globalThis & {
  overtchatHostConnectorBroker?: HostConnectorBroker;
};

export const hostConnectorBroker =
  globalForHostConnector.overtchatHostConnectorBroker ??
  new HostConnectorBroker();

globalForHostConnector.overtchatHostConnectorBroker = hostConnectorBroker;
