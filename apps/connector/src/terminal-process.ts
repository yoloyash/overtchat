import { createRequire } from "node:module";
import { constants } from "node:os";
import type { IPty } from "node-pty";

type Exit = { exitCode: number; signal?: number };
export type TerminalProcess = Pick<IPty, "write" | "resize" | "kill" | "onData" | "onExit"> & {
  pause?: () => void;
  resume?: () => void;
};
export type TerminalSpawnOptions = {
  name: string; cols: number; rows: number; cwd: string; env: Record<string, string>;
};
const require = createRequire(import.meta.url);
// Keep the runtime adapter structural: importing Bun globals changes Node/DOM types
// in all source-consuming workspaces.
interface BunTerminal {
  write(data: string | Uint8Array): number;
  resize(cols: number, rows: number): void;
  close(): void;
}
interface BunPtyRuntime {
  Terminal: unknown;
  spawn(command: string[], options: {
    cwd: string; env: Record<string, string>;
    terminal: { cols: number; rows: number; name: string; data(terminal: BunTerminal, bytes: Uint8Array): void };
  }): { terminal: BunTerminal; exited: Promise<number>; signalCode?: NodeJS.Signals; kill(signal: string): void };
}
const bun = (globalThis as typeof globalThis & { Bun?: BunPtyRuntime }).Bun;

export function terminalProcessSupport(): void {
  if (!["linux", "darwin"].includes(process.platform)) throw new Error("Workspace terminals require a Linux or macOS connector.");
  if (bun) {
    if (typeof bun.Terminal !== "function") throw new Error("This connector runtime does not support workspace terminals.");
  } else require("node-pty");
}

export function spawnTerminal(command: string, args: string[], options: TerminalSpawnOptions): TerminalProcess {
  if (!bun) return (require("node-pty") as typeof import("node-pty")).spawn(command, args, options);
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<(event: Exit) => void>();
  const decoder = new TextDecoder();
  const processHandle = bun.spawn([command, ...args], {
    cwd: options.cwd, env: options.env,
    terminal: {
      cols: options.cols, rows: options.rows, name: options.name,
      data(_terminal, bytes) {
        const data = decoder.decode(bytes, { stream: true });
        if (data) for (const listener of dataListeners) listener(data);
      },
    },
  });
  const terminal = processHandle.terminal!;
  void processHandle.exited.then((exitCode) => {
    const tail = decoder.decode();
    if (tail) for (const listener of dataListeners) listener(tail);
    terminal.close();
    const signal = typeof processHandle.signalCode === "string" ? constants.signals[processHandle.signalCode] : undefined;
    for (const listener of exitListeners) listener({ exitCode, signal });
  });
  return {
    write: (data) => { terminal.write(data); },
    resize: (cols, rows) => terminal.resize(cols, rows),
    kill: () => { terminal.close(); processHandle.kill("SIGHUP"); },
    onData: (listener) => { dataListeners.add(listener); return { dispose: () => { dataListeners.delete(listener); } }; },
    onExit: (listener) => { exitListeners.add(listener); return { dispose: () => { exitListeners.delete(listener); } }; },
  };
}
