import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { requireSuccessful } from "./process.js";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Stage an immutable runtime and return a launcher that can be atomically promoted. */
export async function stageConnectorPackage(
  archive: string,
  temporaryDirectory: string,
  version: string,
): Promise<{ binary: string; payloadDirectory: string }> {
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Invalid connector version.");
  const listing = await requireSuccessful("tar", ["-tzf", archive], { timeoutMs: 30_000 });
  const members = listing.stdout.trim().split("\n");
  if (members.some((name) => !/^overtchat-connector(?:\/|$)/.test(name) || name.split("/").includes(".."))) {
    throw new Error("The connector archive contains an invalid path.");
  }
  const details = await requireSuccessful("tar", ["-tvzf", archive], { timeoutMs: 30_000 });
  if (details.stdout.trim().split("\n").some((line) => !/^[-d]/.test(line))) {
    throw new Error("The connector archive contains unsupported links or special files.");
  }
  const parent = path.join(os.homedir(), ".local", "lib", "overtchat", "connector");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const payloadDirectory = await mkdtemp(path.join(parent, `${version}.`));
  try {
    await requireSuccessful("tar", ["-xzf", archive, "-C", payloadDirectory], { timeoutMs: 30_000 });
    const launcher = path.join(payloadDirectory, "overtchat-connector", "overtchat-connector");
    const checked = await requireSuccessful(launcher, ["version"], { timeoutMs: 10_000 });
    if (checked.stdout.trim() !== version) throw new Error("The connector package failed its version check.");
    const binary = path.join(temporaryDirectory, "overtchat-connector");
    await writeFile(binary, `#!/bin/sh
set -eu
export OVERTCHAT_CONNECTOR_LAUNCHER="$0"
exec ${shellQuote(launcher)} "$@"
`, { mode: 0o755 });
    await chmod(binary, 0o755);
    return { binary, payloadDirectory };
  } catch (error) {
    await rm(payloadDirectory, { recursive: true, force: true });
    throw error;
  }
}
