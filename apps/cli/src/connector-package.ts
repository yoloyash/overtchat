import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { installationBinDirectory } from "./paths.js";
import { requireSuccessful } from "./process.js";

// Escape a path for its launcher: inside cmd.exe double quotes only % is
// special; POSIX launchers single-quote it.
function launcherText(value: string): string {
  return process.platform === "win32" ? value.replaceAll("%", "%%") : value.replaceAll("'", "'\\''");
}

// Windows ships bsdtar. A Git Bash GNU tar earlier in PATH reads "C:" as a host.
function tar(): string {
  return process.platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "tar";
}

/** Immutable connector runtimes beside the launcher's bin directory. */
export function connectorRuntimeDirectory(): string {
  const prefix = path.dirname(installationBinDirectory());
  return process.platform === "win32"
    ? path.join(prefix, "connector")
    : path.join(prefix, "lib", "overtchat", "connector");
}

/** The launcher command for a packaged runtime, without a shell on Windows. */
export function connectorRuntimeCommand(root: string): { command: string; args: string[] } {
  return process.platform === "win32"
    ? { command: path.join(root, "bin", "node.exe"), args: [path.join(root, "app", "connector.mjs")] }
    : { command: path.join(root, "overtchat-connector"), args: [] };
}

function windowsLauncher(root: string): string {
  const { command, args } = connectorRuntimeCommand(root);
  return `@${[command, ...args].map((value) => `"${launcherText(value)}"`).join(" ")} %*\r\n`;
}

/** Stage an immutable runtime and return a launcher that can be atomically promoted. */
export async function stageConnectorPackage(
  archive: string,
  temporaryDirectory: string,
  version: string,
): Promise<{ binary: string; payloadDirectory: string }> {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid connector version.");
  const listing = await requireSuccessful(tar(), ["-tzf", archive], { timeoutMs: 30_000 });
  const members = listing.stdout.trim().split(/\r?\n/u);
  if (members.some((name) => !/^overtchat-connector(?:\/|$)/.test(name) || name.split("/").includes(".."))) {
    throw new Error("The connector archive contains an invalid path.");
  }
  const details = await requireSuccessful(tar(), ["-tvzf", archive], { timeoutMs: 30_000 });
  if (details.stdout.trim().split(/\r?\n/u).some((line) => !/^[-d]/.test(line))) {
    throw new Error("The connector archive contains unsupported links or special files.");
  }
  const parent = connectorRuntimeDirectory();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const payloadDirectory = await mkdtemp(path.join(parent, `${version}.`));
  try {
    await requireSuccessful(tar(), ["-xzf", archive, "-C", payloadDirectory], { timeoutMs: 120_000 });
    const root = path.join(payloadDirectory, "overtchat-connector");
    const runtime = connectorRuntimeCommand(root);
    const checked = await requireSuccessful(runtime.command, [...runtime.args, "version"], { timeoutMs: 10_000 });
    if (checked.stdout.trim() !== version) throw new Error("The connector package failed its version check.");
    if (process.platform === "win32") {
      const binary = path.join(temporaryDirectory, "overtchat-connector.cmd");
      await writeFile(binary, windowsLauncher(root));
      return { binary, payloadDirectory };
    }
    const binary = path.join(temporaryDirectory, "overtchat-connector");
    await writeFile(binary, `#!/bin/sh
set -eu
export OVERTCHAT_CONNECTOR_LAUNCHER="$0"
exec '${launcherText(runtime.command)}' "$@"
`, { mode: 0o755 });
    await chmod(binary, 0o755);
    return { binary, payloadDirectory };
  } catch (error) {
    await rm(payloadDirectory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Remove runtimes that no launcher references. A Windows runtime can remain
 * locked by a stopping process; the next installation removes it instead.
 */
export async function pruneConnectorRuntimes(launchers: string[]): Promise<void> {
  const parent = connectorRuntimeDirectory();
  let entries: string[];
  try { entries = await readdir(parent); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const references = (await Promise.all(launchers.map((launcher) => readFile(launcher, "utf8").catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  })))).join("\n");
  for (const entry of entries) {
    // Only directories created by staging: <version>.<mkdtemp suffix>.
    if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.[A-Za-z0-9]{6}$/u.test(entry)) continue;
    const directory = path.join(parent, entry);
    if (references.includes(launcherText(directory + path.sep))) continue;
    await rm(directory, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 5 : 0 }).catch((error) => {
      if (process.platform !== "win32" || !["EBUSY", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    });
  }
}
