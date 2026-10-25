import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { commandEnvironment } from "./platform.js";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
};

export type RunOptions = {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  input?: string;
  inherit?: boolean;
  timeoutMs?: number;
  windowsVerbatimArguments?: boolean;
};

export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: commandEnvironment(options.environment ?? process.env),
      stdio: options.inherit ? [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"] : "pipe",
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
    });
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    const timeout = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
      forceKill.unref();
    }, options.timeoutMs);
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      resolve({ stdout, stderr, exitCode: timedOut ? 1 : code ?? 1, signal, timedOut });
    });
    // A child can exit before consuming its configuration.
    child.stdin?.on("error", () => {});
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

export async function commandExists(command: string): Promise<boolean> {
  if (process.platform === "win32") {
    const environment = commandEnvironment();
    const directories = /[\\/]/u.test(command) ? [""] : (environment.PATH || "").split(";").filter(Boolean);
    // The manager executes binaries directly, never arbitrary cmd/PowerShell
    // shims. A shell-free probe also works before Git Bash is installed.
    const suffixes = path.extname(command) ? [""] : [".exe", ".com"];
    for (const directory of directories) {
      for (const suffix of suffixes) {
        const file = path.join(directory.replace(/^"|"$/gu, ""), command + suffix);
        if (await stat(file).then((entry) => entry.isFile(), () => false)) return true;
      }
    }
    return false;
  }
  const result = await runCommand("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command]);
  return result.exitCode === 0;
}

export async function requireSuccessful(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  const result = await runCommand(command, args, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    const reason = result.timedOut ? `timed out after ${options.timeoutMs! / 1000}s`
      : result.signal ? `was terminated by ${result.signal}` : `failed (exit ${result.exitCode})`;
    throw new Error(`${[command, ...args].join(" ")} ${reason}${detail ? `: ${detail}` : ""}`);
  }
  return result;
}
