import { existsSync } from "node:fs";
import path from "node:path";
import { spawnTerminal, terminalProcessSupport, type TerminalProcess } from "./terminal-process.js";
import headlessRuntime from "@xterm/headless/lib-headless/xterm-headless.js";
import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  AGENT_TERMINAL_MAX_OUTPUT_CHARS,
  AGENT_TERMINAL_MAX_SNAPSHOT_CHARS,
  type AgentDaemonWorkspaceDescriptor,
  type AgentTerminalEvent,
  type AgentTerminalSize,
  type AgentTerminalSnapshot,
} from "@overtchat/agent-bridge";
import { sshTerminalArgs } from "./ssh.js";
import { HostEnvironments } from "./host-environment.js";
import type { HostEnvironment } from "@overtchat/agent-runtime";

const { Terminal } = headlessRuntime as unknown as {
  Terminal: typeof HeadlessTerminal;
};

export type ConnectorTerminalSupport =
  | { available: true }
  | { available: false; reason: string };

const OUTPUT_COALESCE_MS = 5;
const MAX_PENDING_OUTPUT_CHARS = AGENT_TERMINAL_MAX_OUTPUT_CHARS * 2;
const TERMINAL_SCROLLBACK_LINES = 2_000;
const DEFAULT_TERMINAL_IDLE_TIMEOUT_MS = 15 * 60 * 1_000;

let terminalSupport: true | Error | undefined;

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
  if (terminalSupport instanceof Error) {
    return { available: false, reason: terminalSupport.message };
  }
  if (terminalSupport) return { available: true };
  try {
    terminalProcessSupport();
    terminalSupport = true;
    return { available: true };
  } catch (error) {
    terminalSupport =
      error instanceof Error ? error : new Error(String(error));
    return { available: false, reason: terminalSupport.message };
  }
}

type TerminalSubscriber = {
  workspaceId: string;
  listener: (event: AgentTerminalEvent) => void;
};

type ManagedTerminal = {
  descriptor: AgentDaemonWorkspaceDescriptor;
  pty: TerminalProcess;
  emulator: HeadlessTerminal;
  serializer: SerializeAddon;
  revision: number;
  exited: boolean;
  exitCode: number | null;
  signal: number | null;
  parseTail: Promise<void>;
  parseBytes: number;
  disposed: boolean;
  readsPaused: boolean;
  killed: boolean;
  pendingOutput: string;
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
  left: AgentDaemonWorkspaceDescriptor,
  right: AgentDaemonWorkspaceDescriptor,
): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.connectionId === right.connectionId &&
    left.cwd === right.cwd &&
    left.target.transport === right.target.transport &&
    (left.target.transport === "local" ||
      (right.target.transport === "ssh" &&
        left.target.alias === right.target.alias))
  );
}

// ConPTY's CreateProcess does not apply PATHEXT, so node-pty cannot launch a
// bare "ssh"; resolve the full executable path as child_process would.
function windowsExecutable(name: string): string | undefined {
  for (const directory of (process.env.Path ?? process.env.PATH ?? "").split(";")) {
    const candidate = path.join(directory.replace(/^"|"$/gu, ""), name);
    if (directory && existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Prefer PowerShell 7 when installed, as Windows Terminal does.
function windowsShell(): string {
  return windowsExecutable("pwsh.exe") ??
    path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function sshCommand(): string {
  if (process.platform !== "win32") return "ssh";
  const command = windowsExecutable("ssh.exe");
  if (!command) throw new Error("SSH workspace terminals require the Windows OpenSSH client (ssh.exe) on PATH.");
  return command;
}

function terminalLaunch(descriptor: AgentDaemonWorkspaceDescriptor, platform: HostEnvironment["platform"]): {
  command: string;
  args: string[];
  cwd: string;
} {
  if (descriptor.target.transport === "ssh") {
    return {
      command: sshCommand(),
      args: sshTerminalArgs(descriptor.target.alias, descriptor.cwd, platform),
      cwd: process.cwd(),
    };
  }
  if (process.platform === "win32") return { command: windowsShell(), args: ["-NoLogo"], cwd: descriptor.cwd };
  return {
    command: process.env.SHELL?.trim() || "/bin/sh",
    args: ["-il"],
    cwd: descriptor.cwd,
  };
}

// A second node-pty kill() on Windows can corrupt the native heap.
function killTerminalProcess(terminal: ManagedTerminal): void {
  if (terminal.killed) return;
  terminal.killed = true;
  terminal.pty.kill();
}

function writeToEmulator(
  terminal: ManagedTerminal,
  data: string,
): Promise<void> {
  const bytes = Buffer.byteLength(data);
  terminal.parseBytes += bytes;
  if (!terminal.readsPaused && terminal.parseBytes >= 1024 * 1024) {
    terminal.pty.pause();
    terminal.readsPaused = true;
  }
  // The emulator parses writes in order, so the latest callback marks the tail.
  // Waiting for each callback before the next write costs a timer tick per PTY
  // chunk; ConPTY's small chunks and 15 ms Windows timers made that ~30 KB/s.
  terminal.parseTail = new Promise<void>((resolve) => {
    terminal.emulator.write(data, () => {
      terminal.parseBytes -= bytes;
      if (terminal.readsPaused && !terminal.disposed && terminal.parseBytes < 256 * 1024) {
        terminal.readsPaused = false;
        terminal.pty.resume();
      }
      resolve();
    });
  });
  return terminal.parseTail;
}

export class ConnectorTerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();
  private readonly subscribers = new Map<string, TerminalSubscriber>();
  private readonly pending = new Map<string, {
    descriptor: AgentDaemonWorkspaceDescriptor;
    abort: AbortController;
    ready: Promise<ManagedTerminal>;
  }>();

  constructor(
    private readonly idleTimeoutMs = DEFAULT_TERMINAL_IDLE_TIMEOUT_MS,
    private readonly inspectEnvironment = new HostEnvironments().inspect,
  ) {}

  async subscribe(
    subscriptionId: string,
    descriptor: AgentDaemonWorkspaceDescriptor,
    size: AgentTerminalSize,
    listener: (event: AgentTerminalEvent) => void,
  ): Promise<AgentTerminalSnapshot> {
    this.subscribers.set(subscriptionId, {
      workspaceId: descriptor.workspaceId,
      listener,
    });
    try {
      const terminal = await this.getOrCreate(descriptor, size);
      this.cancelIdleCleanup(terminal);
      this.resize(descriptor.workspaceId, size);
      return await this.snapshot(terminal);
    } catch (error) {
      this.subscribers.delete(subscriptionId);
      this.scheduleIdleCleanup(descriptor.workspaceId);
      throw error;
    }
  }

  unsubscribe(subscriptionId: string): void {
    const subscriber = this.subscribers.get(subscriptionId);
    if (!subscriber) return;
    this.subscribers.delete(subscriptionId);
    this.scheduleIdleCleanup(subscriber.workspaceId);
  }

  write(workspaceId: string, data: string): boolean {
    const terminal = this.terminals.get(workspaceId);
    if (!terminal || terminal.exited) return false;
    terminal.pty.write(data);
    return true;
  }

  resize(workspaceId: string, size: AgentTerminalSize): boolean {
    const terminal = this.terminals.get(workspaceId);
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
    descriptor: AgentDaemonWorkspaceDescriptor,
    size: AgentTerminalSize,
  ): Promise<AgentTerminalSnapshot> {
    this.disposeTerminal(descriptor.workspaceId, true);
    const terminal = await this.getOrCreate(descriptor, size);
    this.scheduleIdleCleanup(descriptor.workspaceId);
    return this.snapshot(terminal);
  }

  kill(workspaceId: string): boolean {
    const pending = this.pending.get(workspaceId);
    if (pending) { this.disposeTerminal(workspaceId, true); return true; }
    const terminal = this.terminals.get(workspaceId);
    if (!terminal || terminal.exited) return false;
    killTerminalProcess(terminal);
    return true;
  }

  disposeWorkspace(workspaceId: string): void {
    const terminal = this.terminals.get(workspaceId);
    if (terminal && !terminal.exited) {
      this.emit(workspaceId, { type: "exit", revision: ++terminal.revision, exitCode: null, signal: 15 });
    }
    this.disposeTerminal(workspaceId, true);
    for (const [subscriptionId, subscriber] of this.subscribers) {
      if (subscriber.workspaceId === workspaceId) {
        this.subscribers.delete(subscriptionId);
      }
    }
  }

  stopWorkspace(workspaceId: string): void {
    this.disposeWorkspace(workspaceId);
  }

  stopConnection(connectionId: string): void {
    for (const terminal of [...this.terminals.values(), ...this.pending.values()]) {
      if (terminal.descriptor.connectionId === connectionId) {
        this.disposeWorkspace(terminal.descriptor.workspaceId);
      }
    }
  }

  stopAll(): void {
    for (const workspaceId of [...this.terminals.keys(), ...this.pending.keys()]) {
      this.disposeWorkspace(workspaceId);
    }
    this.subscribers.clear();
  }

  disconnectSubscribers(): void {
    this.subscribers.clear();
    for (const workspaceId of this.terminals.keys()) {
      this.scheduleIdleCleanup(workspaceId);
    }
  }

  private getOrCreate(
    descriptor: AgentDaemonWorkspaceDescriptor,
    size: AgentTerminalSize,
  ): ManagedTerminal | Promise<ManagedTerminal> {
    const existing = this.terminals.get(descriptor.workspaceId);
    const pending = this.pending.get(descriptor.workspaceId);
    const owner = existing ?? pending;
    if (owner && !sameTerminalOwner(owner.descriptor, descriptor)) {
      throw new Error("The terminal session belongs to a different workspace.");
    }
    if (existing) return existing;
    if (pending) return pending.ready;
    if (this.terminals.size + this.pending.size >= 32) throw new Error("Close an existing workspace terminal before opening another.");
    if (descriptor.target.transport === "local") {
      return this.create(descriptor, size, process.platform === "win32" ? "win32" : "posix");
    }
    const abort = new AbortController();
    const ready = this.inspectEnvironment(descriptor.target, abort.signal).then((environment) => {
      abort.signal.throwIfAborted();
      return this.create(descriptor, size, environment.platform);
    }).finally(() => {
      if (this.pending.get(descriptor.workspaceId)?.ready === ready) this.pending.delete(descriptor.workspaceId);
    });
    this.pending.set(descriptor.workspaceId, { descriptor, abort, ready });
    return ready;
  }

  private create(
    descriptor: AgentDaemonWorkspaceDescriptor,
    size: AgentTerminalSize,
    platform: HostEnvironment["platform"],
  ): ManagedTerminal {
    if (this.terminals.size >= 32) throw new Error("Close an existing workspace terminal before opening another.");
    const launch = terminalLaunch(descriptor, platform);
    const support = connectorTerminalSupport();
    if (!support.available) throw new Error(`Workspace terminal unavailable: ${support.reason}`);
    const emulator = new Terminal({
      cols: size.cols,
      rows: size.rows,
      scrollback: TERMINAL_SCROLLBACK_LINES,
      allowProposedApi: true,
    });
    const serializer = new SerializeAddon();
    emulator.loadAddon(serializer);
    let processHandle: TerminalProcess;
    try {
      processHandle = spawnTerminal(launch.command, launch.args, {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: launch.cwd,
      env: {
        ...processEnvironment(),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        OVERTCHAT_AGENT_WORKSPACE_ID: descriptor.workspaceId,
      },
      });
    } catch (error) {
      serializer.dispose();
      emulator.dispose();
      throw error;
    }
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
      parseBytes: 0,
      disposed: false,
      readsPaused: false,
      killed: false,
      pendingOutput: "",
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
    this.terminals.set(descriptor.workspaceId, terminal);
    return terminal;
  }

  private queueOutput(terminal: ManagedTerminal, data: string): void {
    if (this.terminals.get(terminal.descriptor.workspaceId) !== terminal) return;
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
    if (terminal.pendingOutput.length >= MAX_PENDING_OUTPUT_CHARS) {
      if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
      this.flushOutputWindow(terminal);
    }
  }

  private flushOutputWindow(terminal: ManagedTerminal): void {
    terminal.outputTimer = null;
    if (this.terminals.get(terminal.descriptor.workspaceId) !== terminal) return;
    const output = terminal.pendingOutput;
    terminal.pendingOutput = "";
    if (!output) return;
    this.publishOutput(terminal, output);
    terminal.outputTimer = setTimeout(
      () => this.flushOutputWindow(terminal),
      OUTPUT_COALESCE_MS,
    );
    terminal.outputTimer.unref();
  }

  private publishOutput(terminal: ManagedTerminal, output: string): void {
    for (let offset = 0; offset < output.length;) {
      let end = Math.min(offset + AGENT_TERMINAL_MAX_OUTPUT_CHARS, output.length);
      if (end < output.length && /[\uD800-\uDBFF]/u.test(output[end - 1])) end -= 1;
      const data = output.slice(offset, end);
      offset = end;
      const event: AgentTerminalEvent = {
        type: "output",
        revision: ++terminal.revision,
        data,
      };
      this.emit(terminal.descriptor.workspaceId, event);
    }
  }

  private async finishExit(
    terminal: ManagedTerminal,
    exitCode: number,
    signal: number | undefined,
  ): Promise<void> {
    if (this.terminals.get(terminal.descriptor.workspaceId) !== terminal) return;
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    terminal.outputTimer = null;
    if (terminal.pendingOutput) {
      this.publishOutput(terminal, terminal.pendingOutput);
      terminal.pendingOutput = "";
    }
    await terminal.parseTail;
    if (this.terminals.get(terminal.descriptor.workspaceId) !== terminal) return;
    terminal.exited = true;
    terminal.exitCode = exitCode;
    terminal.signal = signal ?? null;
    this.emit(terminal.descriptor.workspaceId, {
      type: "exit",
      revision: ++terminal.revision,
      exitCode,
      signal: signal ?? null,
    });
    this.scheduleIdleCleanup(terminal.descriptor.workspaceId);
  }

  private emit(workspaceId: string, event: AgentTerminalEvent): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.workspaceId === workspaceId) subscriber.listener(event);
    }
  }

  private async snapshot(
    terminal: ManagedTerminal,
  ): Promise<AgentTerminalSnapshot> {
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    this.flushOutputWindow(terminal);
    const revision = terminal.revision;
    await terminal.parseTail;
    if (terminal.disposed) throw new Error("The workspace terminal was stopped.");
    let data = "";
    for (const scrollback of [2_000, 1_000, 500, 200, 0]) {
      data = terminal.serializer.serialize({ scrollback });
      if (Buffer.byteLength(JSON.stringify(data)) <= AGENT_TERMINAL_MAX_SNAPSHOT_CHARS) break;
    }
    if (Buffer.byteLength(JSON.stringify(data)) > AGENT_TERMINAL_MAX_SNAPSHOT_CHARS) {
      throw new Error("The terminal snapshot is too large to reconnect.");
    }
    return {
      workspaceId: terminal.descriptor.workspaceId,
      revision,
      data,
      cols: terminal.emulator.cols,
      rows: terminal.emulator.rows,
      exited: terminal.exited,
      exitCode: terminal.exitCode,
      signal: terminal.signal,
    };
  }

  private disposeTerminal(workspaceId: string, kill: boolean): void {
    this.pending.get(workspaceId)?.abort.abort();
    this.pending.delete(workspaceId);
    const terminal = this.terminals.get(workspaceId);
    if (!terminal) return;
    this.terminals.delete(workspaceId);
    terminal.disposed = true;
    if (terminal.outputTimer) clearTimeout(terminal.outputTimer);
    terminal.outputTimer = null;
    if (terminal.idleTimer) clearTimeout(terminal.idleTimer);
    terminal.idleTimer = null;
    for (const disposable of terminal.disposables) disposable.dispose();
    terminal.serializer.dispose();
    terminal.emulator.dispose();
    // node-pty releases its Windows output worker only in kill(), even after
    // the shell has exited on its own.
    if (kill && (!terminal.exited || process.platform === "win32")) {
      try {
        killTerminalProcess(terminal);
      } catch {
        // The PTY may have exited between the state check and cleanup.
      }
    }
  }

  private hasSubscribers(workspaceId: string): boolean {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.workspaceId === workspaceId) return true;
    }
    return false;
  }

  private cancelIdleCleanup(terminal: ManagedTerminal): void {
    if (!terminal.idleTimer) return;
    clearTimeout(terminal.idleTimer);
    terminal.idleTimer = null;
  }

  private scheduleIdleCleanup(workspaceId: string): void {
    const terminal = this.terminals.get(workspaceId);
    if (!terminal || !terminal.exited || terminal.idleTimer || this.hasSubscribers(workspaceId)) {
      return;
    }
    terminal.idleTimer = setTimeout(() => {
      terminal.idleTimer = null;
      if (
        this.terminals.get(workspaceId) === terminal &&
        !this.hasSubscribers(workspaceId)
      ) {
        this.disposeTerminal(workspaceId, true);
      }
    }, this.idleTimeoutMs);
    terminal.idleTimer.unref();
  }
}

export async function runConnectorTerminalSmoke(outputBytes = 0): Promise<void> {
  if (!Number.isSafeInteger(outputBytes) || outputBytes < 0 || outputBytes > 64 * 1024 * 1024) {
    throw new Error("Terminal smoke output must be between 0 and 64 MiB.");
  }
  const manager = new ConnectorTerminalManager();
  const workspaceId = `terminal-smoke-${process.pid}`;
  const marker = `overtchat-terminal-smoke-${process.pid}`;
  let output = "";
  let received = 0;
  let sent = false;
  let exiting = false;
  // Windows PowerShell echoes input, so its markers are assembled at runtime and
  // only executed output matches. ConPTY repaints the screen rather than
  // forwarding the byte stream, so bulk output proves flow, not an exact count.
  const windows = process.platform === "win32";
  const readyCommand = windows ? "Write-Output ('REA' + 'DY')\r" : "stty -echo; printf '\\nREADY\\n'\r";
  const finishCommand = windows
    ? `${outputBytes ? `[Console]::Out.Write([string]::new([char]81, ${outputBytes})); ` : ""}Write-Output ('overtchat-terminal-smoke-' + ${process.pid})\r`
    : `${outputBytes ? `head -c ${outputBytes} /dev/zero | tr '\\0' '\\121'; ` : ""}printf '\\novertchat-%s-%s\\n' terminal-smoke ${process.pid}\r`;
  let timeout: NodeJS.Timeout | undefined;
  let retry: NodeJS.Timeout | undefined;
  try {
    const exited = new Promise<void>((resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Timed out waiting for terminal smoke test.")),
        outputBytes ? 60_000 : 10_000,
      );
      manager
        .subscribe(
          "terminal-smoke",
          {
            connectionId: "terminal-smoke",
            workspaceId,
            provider: "codex",
            target: { transport: "local", shellMode: "login" },
            executable: "codex",
            cwd: process.cwd(),
          },
          { cols: 80, rows: 24 },
          (event) => {
            if (event.type === "output") {
              received += event.data.split("Q").length - 1;
              output = (output + event.data).slice(-4096);
              if (!sent && output.includes(windows ? "READY" : "\r\nREADY\r\n")) {
                sent = true;
                clearInterval(retry);
                output = "";
                received = 0;
                manager.write(workspaceId, finishCommand);
              }
              // A PTY can drop output written just before the shell exits, so
              // exit only after the marker arrives.
              if (sent && !exiting && output.includes(marker)) {
                exiting = true;
                manager.write(workspaceId, "exit\r");
              }
            }
            else resolve();
          },
        )
        .then(() => {
          // POSIX disables echo so only executed output satisfies the check.
          manager.write(workspaceId, readyCommand);
          // PowerShell discards input that arrives before it is ready to read.
          if (windows) retry = setInterval(() => manager.write(workspaceId, readyCommand), 1_000);
        }, reject);
    });
    await exited;
    if (!output.includes(marker)) {
      throw new Error("Terminal smoke test did not receive shell output.");
    }
    if (windows ? outputBytes > 0 && received === 0 : received !== outputBytes) throw new Error(`Terminal smoke output mismatch: ${received}/${outputBytes} bytes.`);
  } finally {
    if (timeout) clearTimeout(timeout);
    clearInterval(retry);
    manager.stopAll();
  }
}
