import { spawn } from "node:child_process";

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type RunOptions = {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  input?: string;
  inherit?: boolean;
};

export async function runCommand(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.environment ?? process.env,
      stdio: options.inherit ? ["pipe", "inherit", "inherit"] : "pipe",
    });
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
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
    else child.stdin?.end();
  });
}

export async function commandExists(command: string): Promise<boolean> {
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
    throw new Error(
      `${[command, ...args].join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result;
}
