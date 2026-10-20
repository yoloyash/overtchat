import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HostEnvironment, HostTarget } from "@overtchat/agent-runtime";
import { sshCommandArgs } from "./ssh.js";

const execFileAsync = promisify(execFile);
const CACHE_MS = 60_000;
export type ExecutionEnvironment = HostEnvironment & {
  node?: string;
  nodeVersion?: string;
};

export function powershellCommand(script: string): string {
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}

export function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function runHostControl(
  target: HostTarget,
  command: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await execFileAsync(
    target.transport === "ssh"
      ? "ssh"
      : process.platform === "win32"
        ? "cmd.exe"
        : "/bin/sh",
    target.transport === "ssh"
      ? sshCommandArgs(target.alias, command)
      : process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-c", command],
    {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      signal,
      windowsHide: true,
    },
  );
  return result.stdout;
}

/** Only successful probes are cached. Expiry lets refreshed discovery see PATH changes. */
export class HostEnvironments {
  private readonly cache = new Map<
    string,
    {
      expires: number;
      value: Promise<ExecutionEnvironment>;
      settled?: ExecutionEnvironment;
    }
  >();
  constructor(private readonly run = runHostControl) {}

  invalidate(target: HostTarget): void {
    this.cache.delete(target.transport === "local" ? "local" : target.alias);
  }

  inspect = (
    target: HostTarget,
    signal?: AbortSignal,
  ): Promise<ExecutionEnvironment> => {
    signal?.throwIfAborted();
    if (target.transport === "local" && process.platform !== "win32")
      return Promise.resolve({ platform: "posix" });
    const key = target.transport === "local" ? "local" : target.alias;
    const existing = this.cache.get(key);
    if (
      existing &&
      existing.expires > Date.now() &&
      (!signal || existing.settled)
    )
      return existing.value;
    // Recovery has its own cancellation scope. Do not make live launches share
    // an in-flight probe that will be aborted during connector shutdown.
    if (signal)
      return this.probe(target, signal).then((settled) => {
        this.cache.set(key, {
          expires: Date.now() + CACHE_MS,
          value: Promise.resolve(settled),
          settled,
        });
        return settled;
      });
    const value = this.probe(target)
      .then((settled) => {
        const entry = this.cache.get(key);
        if (entry?.value === value) entry.settled = settled;
        return settled;
      })
      .catch((error) => {
        if (this.cache.get(key)?.value === value) this.cache.delete(key);
        throw error;
      });
    this.cache.set(key, { expires: Date.now() + CACHE_MS, value });
    return value;
  };

  private async probe(
    target: HostTarget,
    signal?: AbortSignal,
  ): Promise<ExecutionEnvironment> {
    // A fixed POSIX probe cannot accidentally execute user-provided commands.
    // SSH transport errors are not shell mismatches and must retain their diagnostics.
    if (target.transport === "ssh") {
      try {
        if (
          (await this.run(target, "uname -s", signal))
            .split(/\r?\n/u)
            .some((line) => /^(Linux|Darwin|.*BSD)$/u.test(line.trim()))
        )
          return { platform: "posix" };
      } catch (error) {
        signal?.throwIfAborted();
        if (
          (error as { code?: unknown }).code === 255 ||
          (error as { killed?: boolean }).killed
        )
          throw error;
      }
    }
    let overrides: Record<string, string> = {};
    if (process.env.OVERTCHAT_SSH_NODE_PATHS) {
      const parsed: unknown = JSON.parse(process.env.OVERTCHAT_SSH_NODE_PATHS);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== "string")
      )
        throw new Error(
          "OVERTCHAT_SSH_NODE_PATHS must be a JSON object mapping SSH aliases to node.exe paths.",
        );
      overrides = parsed as Record<string, string>;
    }
    const override =
      target.transport === "ssh" ? overrides[target.alias] : process.execPath;
    const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$node = ${override ? powershellLiteral(override) : "(Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source)"}
if (-not $node) {
  $candidates = @("$env:ProgramFiles\\nodejs\\node.exe", "$env:LOCALAPPDATA\\Programs\\nodejs\\node.exe", "$env:LOCALAPPDATA\\Volta\\bin\\node.exe")
  $node = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if ($node -and -not (Test-Path -LiteralPath $node -PathType Leaf)) { $node=$null }
$version = if ($node) { & $node --version } else { $null }
@{platform='win32';node=$node;version=$version} | ConvertTo-Json -Compress
`;
    try {
      const result = JSON.parse(
        (await this.run(target, powershellCommand(script), signal)).trim(),
      ) as { platform?: unknown; node?: unknown; version?: unknown };
      if (result.platform !== "win32")
        throw new Error("Invalid Windows host probe.");
      return {
        platform: "win32",
        ...(typeof result.node === "string" && result.node
          ? { node: result.node }
          : {}),
        ...(typeof result.version === "string"
          ? { nodeVersion: result.version }
          : {}),
      };
    } catch (error) {
      throw new Error(
        `Unable to inspect SSH host. OvertChat requires a POSIX shell or Windows PowerShell. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
