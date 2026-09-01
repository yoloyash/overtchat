import type { IPty } from "node-pty";
import { createRequire as createNodeRequire } from "node:module";
import headlessRuntime from "@xterm/headless/lib-headless/xterm-headless.js";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  AGENT_TERMINAL_MAX_OUTPUT_CHARS,
  AGENT_TERMINAL_MAX_SNAPSHOT_CHARS,
  type AgentDaemonSessionDescriptor,
  type AgentTerminalEvent,
  type AgentTerminalSize,
  type AgentTerminalSnapshot,
} from "@overtchat/agent-bridge";
import { sshTerminalArgs } from "./ssh.js";

/* eslint-disable @typescript-eslint/no-require-imports -- Bun only embeds the
 * architecture-specific N-API addon when these paths remain static requires. */

const { Terminal } = headlessRuntime as unknown as {
  Terminal: typeof HeadlessTerminal;
};

type NodePtyModule = typeof import("node-pty");
type NodePtyNativeModule = {
  fork: (...args: unknown[]) => unknown;
};

export type ConnectorTerminalSupport =
  | { available: true }
  | { available: false; reason: string };

const nodeRequire = createNodeRequire(import.meta.url);
const isBunRuntime = "bun" in process.versions;

function loadNodePtyNative(): NodePtyNativeModule {
  if (process.arch !== "x64" && process.arch !== "arm64") {
    throw new Error(
      `Workspace terminals do not support Linux ${process.arch}.`,
    );
  }
  if (process.arch === "arm64") {
    return isBunRuntime
      ? require("node-pty/prebuilds/linux-arm64/pty.node")
      : (nodeRequire(
          "node-pty/prebuilds/linux-arm64/pty.node",
        ) as NodePtyNativeModule);
  }
  return isBunRuntime
    ? require("node-pty/prebuilds/linux-x64/pty.node")
    : (nodeRequire(
        "node-pty/prebuilds/linux-x64/pty.node",
      ) as NodePtyNativeModule);
}

function loadNodePty(): NodePtyModule {
  if (process.platform === "linux") {
    const native = loadNodePtyNative();
    const utils = (isBunRuntime
      ? require("node-pty/lib/utils.js")
      : nodeRequire("node-pty/lib/utils.js")) as {
      loadNativeModule(name: string): {
        dir: string;
        module: NodePtyNativeModule;
      };
    };
    utils.loadNativeModule = (name) => {
      if (name !== "pty") throw new Error(`Unsupported PTY module ${name}.`);
      return {
        dir: `../prebuilds/linux-${process.arch}`,
        module: native,
      };
    };
  }
  return (isBunRuntime
    ? require("node-pty")
    : nodeRequire("node-pty")) as NodePtyModule;
}

const OUTPUT_COALESCE_MS = 5;
const MAX_PENDING_OUTPUT_CHARS = AGENT_TERMINAL_MAX_OUTPUT_CHARS * 2;
const TERMINAL_SCROLLBACK_LINES = 2_000;
const DEFAULT_TERMINAL_IDLE_TIMEOUT_MS = 15 * 60 * 1_000;

let loadedNodePty: NodePtyModule | Error | undefined;

function terminalDisabled(): boolean {
  return /^(?:1|true)$/iu.test(
    process.env.OVERTCHAT_DISABLE_AGENT_TERMINAL?.trim() ?? "",
  );
}

export function connectorTerminalSupport(): ConnectorTerminalSupport {
  if (terminalDisabled()) {
    return {
      available: false,
      reason: "Workspace terminals are disabled on this Host Connector.",
    };
  }
  if (loadedNodePty instanceof Error) {
    return { available: false, reason: loadedNodePty.message };
  }
  if (loadedNodePty) return { available: true };
  try {
    loadedNodePty = loadNodePty();
    return { available: true };
  } catch (error) {
    loadedNodePty =
      error instanceof Error ? error : new Error(String(error));
    return { available: false, reason: loadedNodePty.message };
  }
}

function requireNodePty(): NodePtyModule {
  const support = connectorTerminalSupport();
  if (!support.available) {
    throw new Error(`Workspace terminal unavailable: ${support.reason}`);
  }
  return loadedNodePty as NodePtyModule;
}

type TerminalSubscriber = {
  sessionId: string;
  listener: (event: AgentTerminalEvent) => void;
};

type ManagedTerminal = {
  descriptor: AgentDaemonSessionDescriptor;
  pty: IPty;
  emulator: HeadlessTerminal;
  serializer: SerializeAddon;
  revision: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  parseTail: Promise<void>;
  pendingOutput: string;
  outputTruncated: boolean;
  outputTimer: NodeJS.Timeout | null;
  idleTimer: NodeJS.Timeout | null;
  disposables: Array<{ dispose(): void }>;
};

function processEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  );
}

function sameTerminalOwner(
  left: AgentDaemonSessionDescriptor,
  right: AgentDaemonSessionDescriptor,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.workspaceId === right.workspaceId &&
    left.connectionId === right.connectionId &&
    left.cwd === right.cwd &&
    left.target.transport === right.target.transport &&
    (left.target.transport === "local" ||
      (right.target.transport === "ssh" &&
        left.target.alias === right.target.alias))
  );
}

function terminalLaunch(descriptor: AgentDaemonSessionDescriptor): {
  command: string;
  args: string[];
  cwd: string;
} {
  if (descriptor.target.transport === "ssh") {
    return {
      command: "ssh",
      args: sshTerminalArgs(descriptor.target.alias, descriptor.cwd),
      cwd: process.cwd(),
    };
  }
  return {
    command: process.env.SHELL?.trim() || "/bin/sh",
    args: ["-il"],
    cwd: descriptor.cwd,
  };
}

function writeToEmulator(
  terminal: ManagedTerminal,
  data: string,
): Promise<void> {
  terminal.parseTail = terminal.parseTail.then(
    () =>
      new Promise<void>((resolve) => {
        terminal.emulator.write(data, resolve);
      }),
  );
  return terminal.parseTail;
}

export class ConnectorTerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly subscribers = new Map<string, TerminalSubscriber>();

  constructor(
    private readonly idleTimeoutMs = DEFAULT_TERMINAL_IDLE_TIMEOUT_MS,
  ) {}

  async subscribe(
    subscriptionId: string,
    descriptor: AgentDaemonSessionDescriptor,
    size: AgentTerminalSize,
    listener: (event: AgentTerminalEvent) => void,
  ): Promise<AgentTerminalSnapshot> {
    this.subscribers.set(subscriptionId, {
      sessionId: descriptor.sessionId,
      listener,
    });
    try {
      const terminal = this.getOrCreate(descriptor, size);
      this.cancelIdleCleanup(terminal);
      this.resize(descriptor.sessionId, size);
      return await this.snapshot(terminal);
    } catch (error) {
      this.subscribers.delete(subscriptionId);
      this.scheduleIdleCleanup(descriptor.sessionId);
      throw error;
    }
  }

  unsubscribe(subscriptionId: string): void {
    const subscriber = this.subscribers.get(subscriptionId);
    if (!subscriber) return;
    this.subscribers.delete(subscriptionId);
    this.scheduleIdleCleanup(subscriber.sessionId);
  }

  write(sessionId: string, data: string): boolean {
    const terminal = this.terminals.get(sessionId);
    if (!terminal || terminal.exited) return false;
    terminal.pty.write(data);
    return true;
  }

  resize(sessionId: string, size: AgentTerminalSize): boolean {
    const terminal = this.terminals.get(sessionId);
    if (!terminal || terminal.exited) return false;
    if (
      terminal.emulator.cols === size.cols &&
      terminal.emulator.rows === size.rows
    ) {
      return true;
    }
    terminal.emulator.resize(size.cols, size.rows);
    try {
      terminal.pty.resize(size.cols, size.rows);
    } catch {
      return false;
    }
    return true;
  }

  async restart(
    descriptor: AgentDaemonSessionDescriptor,
    size: AgentTerminalSize,
  ): Promise<AgentTerminalSnapshot> {
    this.disposeTerminal(descriptor.sessionId, true);
    const terminal = this.create(descriptor, size);
    this.scheduleIdleCleanup(descriptor.sessionId);
    return this.snapshot(terminal);
  }

  kill(sessionId: string): boolean {
    const terminal = this.terminals.get(sessionId);
    if (!terminal || terminal.exited) return false;
    terminal.pty.kill();
    return true;
  }

  stopSession(sessionId: string): void {
    this.disposeTerminal(sessionId, true);
    for (const [subscriptionId, subscriber] of this.subscribers) {
      if (subscriber.sessionId === sessionId) {
        this.subscribers.delete(subscriptionId);
      }
    }
  }

  stopWorkspace(workspaceId: string): void {
    for (const terminal of [...this.terminals.values()]) {
      if (terminal.descriptor.workspaceId === workspaceId) {
        this.stopSession(terminal.descriptor.sessionId);
      }
    }
  }

  stopConnection(connectionId: string): void {
    for (const terminal of [...this.terminals.values()]) {
      if (terminal.descriptor.connectionId === connectionId) {
        this.stopSession(terminal.descriptor.sessionId);
      }
    }
  }

  stopAll(): void {
    for (const sessionId of [...this.terminals.keys()]) {
      this.stopSession(sessionId);
    }
    this.subscribers.clear();
  }

  disconnectSubscribers(): void {
    this.subscribers.clear();
    for (const sessionId of this.terminals.keys()) {
      this.scheduleIdleCleanup(sessionId);
    }
  }

  private getOrCreate(
    descriptor: AgentDaemonSessionDescriptor,
    size: AgentTerminalSize,
  ): ManagedTerminal {
    const existing = this.terminals.get(descriptor.sessionId);
    if (!existing) return this.create(descriptor, size);
    if (!sameTerminalOwner(existing.descriptor, descriptor)) {
      throw new Error("The terminal session belongs to a different workspace.");
    }
    return existing;
  }

  private create(
    descriptor: AgentDaemonSessionDescriptor,
    size: AgentTerminalSize,
  ): ManagedTerminal {
    const launch = terminalLaunch(descriptor);
    const pty = requireNodePty();
    const emulator = new Terminal({
      cols: size.cols,
      rows: size.rows,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    emulator.loadAddon(serializer);
    const processHandle = pty.spawn(launch.command, launch.args, {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: launch.cwd,
      env: {
        ...processEnvironment(),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        OVERTCHAT_AGENT_SESSION_ID: descriptor.sessionId,
        OVERTCHAT_AGENT_WORKSPACE_ID: descriptor.workspaceId,
      },
    });
    const terminal: ManagedTerminal = {
      descriptor,
      pty: processHandle,
      emulator,
      serializer,
      revision: 0,
      exited: false,
      exitCode: null,
      signal: null,
      parseTail: Promise.resolve(),
      pendingOutput: "",
      outputTruncated: false,
      outputTimer: null,
      idleTimer: null,
      disposables: [],
    };
    terminal.disposables.push(
      processHandle.onData((data) => this.queueOutput(terminal, data)),
      processHandle.onExit(({ exitCode, signal }) => {
        void this.finishExit(terminal, exitCode, signal);
      }),
    );
    this.terminals.set(descriptor.sessionId, terminal);
    return terminal;
  }

  private queueOutput(terminal: ManagedTerminal, data: string): void {
    if (this.terminals.get(terminal.descriptor.sessionId) !== terminal) return;
    void writeToEmulator(terminal, data);
    if (!terminal.outputTimer && terminal.pendingOutput.length === 0) {
      this.publishOutput(terminal, data);
      terminal.outputTimer = setTimeout(
        () => this.flushOutputWindow(terminal),
        OUTPUT_COALESCE_MS,
      );
      terminal.outputTimer.unref();
      return;
    }
    terminal.pendingOutput += data;
    if (terminal.pendingOutput.length > MAX_PENDING_OUTPUT_CHARS) {
      terminal.pendingOutput = terminal.pendingOutput.slice(
        -MAX_PENDING_OUTPUT_CHARS,
      );
      if (!terminal.outputTruncated) {
        // Deliberately leave a revision gap. The web broker will close the
        // stream and the browser will recover from the headless snapshot.
        terminal.revision += 1;
        terminal.outputTruncated = true;
      }
    }
  }

  private flushOutputWindow(terminal: ManagedTerminal): void {
    terminal.outputTimer = null;
    if (this.terminals.get(terminal.descriptor.sessionId) !== terminal) return;
    const output = terminal.pendingOutput;
    terminal.pendingOutput = "";
    terminal.outputTruncated = false;
    if (!output) return;
    this.publishOutput(terminal, output);
    terminal.outputTimer = setTimeout(
      () => this.flushOutputWindow(terminal),
      OUTPUT_COALESCE_MS,
    );
    terminal.outputTimer.unref();
  }

  private publishOutput(terminal: ManagedTerminal, output: string): void {
    for (
      let offset = 0;
      offset < output.length;
      offset += AGENT_TERMINAL_MAX_OUTPUT_CHARS
    ) {
      const data = output.slice(
        offset,
        offset + AGENT_TERMINAL_MAX_OUTPUT_CHARS,
      );
      const event: AgentTerminalEvent = {
        type: "output",
        revision: ++terminal.revision,
        data,
      };
      this.emit(terminal.descriptor.sessionId, event);
    }
  }

  private async finishExit(
    terminal: ManagedTerminal,
    exitCode: number,
    signal: number | undefined,
  ): Promise<void> {
    if (this.terminals.get(terminal.descriptor.sessionId) !== terminal) return;
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    terminal.outputTimer = null;
    if (terminal.pendingOutput) {
      this.publishOutput(terminal, terminal.pendingOutput);
      terminal.pendingOutput = "";
    }
    await terminal.parseTail;
    terminal.exited = true;
    terminal.exitCode = exitCode;
    terminal.signal = signal ?? null;
    this.emit(terminal.descriptor.sessionId, {
      type: "exit",
      revision: ++terminal.revision,
      exitCode,
      signal: signal ?? null,
    });
    this.scheduleIdleCleanup(terminal.descriptor.sessionId);
  }

  private emit(sessionId: string, event: AgentTerminalEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.sessionId === sessionId) subscriber.listener(event);
    }
  }

  private async snapshot(
    terminal: ManagedTerminal,
  ): Promise<AgentTerminalSnapshot> {
    await terminal.parseTail;
    let data = "";
    for (const scrollback of [2_000, 1_000, 500, 200, 0]) {
      data = terminal.serializer.serialize({ scrollback });
      if (data.length <= AGENT_TERMINAL_MAX_SNAPSHOT_CHARS) break;
    }
    if (data.length > AGENT_TERMINAL_MAX_SNAPSHOT_CHARS) {
      throw new Error("The terminal snapshot is too large to reconnect.");
    }
    return {
      sessionId: terminal.descriptor.sessionId,
      revision: terminal.revision,
      data,
      cols: terminal.emulator.cols,
      rows: terminal.emulator.rows,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    };
  }

  private disposeTerminal(sessionId: string, kill: boolean): void {
    const terminal = this.terminals.get(sessionId);
    if (!terminal) return;
    this.terminals.delete(sessionId);
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    terminal.outputTimer = null;
    if (terminal.idleTimer) clearTimeout(terminal.idleTimer);
    terminal.idleTimer = null;
    for (const disposable of terminal.disposables) disposable.dispose();
    terminal.serializer.dispose();
    terminal.emulator.dispose();
    if (kill && !terminal.exited) {
      try {
        terminal.pty.kill();
      } catch {
        // The PTY may have exited between the state check and cleanup.
      }
    }
  }

  private hasSubscribers(sessionId: string): boolean {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.sessionId === sessionId) return true;
    }
    return false;
  }

  private cancelIdleCleanup(terminal: ManagedTerminal): void {
    if (!terminal.idleTimer) return;
    clearTimeout(terminal.idleTimer);
    terminal.idleTimer = null;
  }

  private scheduleIdleCleanup(sessionId: string): void {
    const terminal = this.terminals.get(sessionId);
    if (!terminal || terminal.idleTimer || this.hasSubscribers(sessionId)) {
      return;
    }
    terminal.idleTimer = setTimeout(() => {
      terminal.idleTimer = null;
      if (
        this.terminals.get(sessionId) === terminal &&
        !this.hasSubscribers(sessionId)
      ) {
        this.disposeTerminal(sessionId, true);
      }
    }, this.idleTimeoutMs);
    terminal.idleTimer.unref();
  }
}

export async function runConnectorTerminalSmoke(): Promise<void> {
  const manager = new ConnectorTerminalManager();
  const sessionId = `terminal-smoke-${process.pid}`;
  const marker = `overtchat-terminal-smoke-${process.pid}`;
  let output = "";
  let timeout: NodeJS.Timeout | undefined;
  try {
    const exited = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Timed out waiting for terminal smoke test.")),
        10_000,
      );
      manager
        .subscribe(
          "terminal-smoke",
          {
            connectionId: "terminal-smoke",
            workspaceId: "terminal-smoke",
            provider: "codex",
            target: { transport: "local", shellMode: "login" },
            executable: "codex",
            cwd: process.cwd(),
            sessionId,
            providerSessionId: "terminal-smoke",
            providerSessionPath: "/terminal-smoke",
            launchConfig: {},
          },
          { cols: 80, rows: 24 },
          (event) => {
            if (event.type === "output") output += event.data;
            else resolve();
          },
        )
        .then(() => {
          manager.write(sessionId, `printf '${marker}\\n'; exit\r`);
        }, reject);
    });
    await exited;
    if (!output.includes(marker)) {
      throw new Error("Terminal smoke test did not receive shell output.");
    }
  } finally {
    if (timeout) clearTimeout(timeout);
    manager.stopAll();
  }
}
