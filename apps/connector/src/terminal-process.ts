import { createRequire } from "node:module";
import type { IPty } from "node-pty";

export type TerminalProcess = Pick<IPty, "write" | "resize" | "kill" | "onData" | "onExit" | "pause" | "resume">;
export type TerminalSpawnOptions = {
  name: string; cols: number; rows: number; cwd: string; env: Record<string, string>;
};
const require = createRequire(import.meta.url);

export function terminalProcessSupport(): void {
  if (!["linux", "darwin"].includes(process.platform)) throw new Error("Workspace terminals require a Linux or macOS connector.");
  if (process.versions.bun) throw new Error("The Host Connector requires Node.js. Install the packaged connector runtime.");
  require("node-pty");
}

export function spawnTerminal(command: string, args: string[], options: TerminalSpawnOptions): TerminalProcess {
  terminalProcessSupport();
  return (require("node-pty") as typeof import("node-pty")).spawn(command, args, options);
}
