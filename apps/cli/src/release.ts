import { BinaryUpdate } from "./binary-update.js";
import { ProcessLock } from "./process-lock.js";
import { releaseAsset } from "./platform.js";
import { executableName, installationBinDirectory } from "./paths.js";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  CLI_VERSION,
  APP_IMAGE,
  CONNECTOR_REPOSITORY,
  RELEASE_MANIFEST_URL,
  VOICE_IMAGE,
} from "./constants.js";
import { runCommand } from "./process.js";
import type { InstallationConfig } from "./types.js";

export type ReleaseManifest = {
  format: 1;
  cliVersion: string;
  appVersion: string;
  voiceVersion: string;
  connectorVersion: string;
  sttVersion: string;
  sandboxVersion: string;
  redisImage: string;
  searxngImage: string;
  kokoroImage: string;
  kokoroGpuImage: string;
  kokoroGpuBlackwellImage: string;
  cloudTunnelImage: string;
  cloudProxyImage: string;
};

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

export function compareVersions(left: string, right: string): number {
  if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
    throw new Error("Cannot compare an invalid OvertChat component version.");
  }
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function applyReleaseManifest(
  config: InstallationConfig,
  manifest: ReleaseManifest,
): InstallationConfig {
  const appVersion =
    compareVersions(manifest.appVersion, config.appVersion) > 0
      ? manifest.appVersion
      : config.appVersion;
  const connectorVersion =
    compareVersions(manifest.connectorVersion, config.connectorVersion) > 0
      ? manifest.connectorVersion
      : config.connectorVersion;
  const voiceVersion =
    compareVersions(manifest.voiceVersion, config.voiceVersion) > 0
      ? manifest.voiceVersion
      : config.voiceVersion;
  const sttVersion =
    compareVersions(manifest.sttVersion, config.sttVersion) > 0
      ? manifest.sttVersion
      : config.sttVersion;
  const sandboxVersion =
    compareVersions(manifest.sandboxVersion, config.sandboxVersion) > 0
      ? manifest.sandboxVersion
      : config.sandboxVersion;

  return {
    ...config,
    appVersion,
    appImage:
      config.appImage === "overtchat-app:setup-dev"
        ? config.appImage
        : `${APP_IMAGE}:${appVersion}`,
    voiceImage:
      config.voiceImage === "overtchat-voice:setup-dev"
        ? config.voiceImage
        : `${VOICE_IMAGE}:${voiceVersion}`,
    voiceVersion,
    connectorVersion,
    sttVersion,
    sandboxVersion,
    redisImage: manifest.redisImage,
    searxngImage: manifest.searxngImage,
    kokoroImage: manifest.kokoroImage,
    kokoroGpuImage: manifest.kokoroGpuImage,
    kokoroGpuBlackwellImage: manifest.kokoroGpuBlackwellImage,
    cloudTunnelImage: manifest.cloudTunnelImage,
    cloudProxyImage: manifest.cloudProxyImage,
  };
}

function assertVersion(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) {
    throw new Error(`The release manifest has an invalid ${field}.`);
  }
}

function assertDigestImage(
  value: unknown,
  field: string,
  repository: string,
): asserts value is string {
  const prefix = `${repository}@sha256:`;
  if (
    typeof value !== "string" ||
    !value.startsWith(prefix) ||
    !/^[a-f0-9]{64}$/u.test(value.slice(prefix.length))
  ) {
    throw new Error(`The release manifest has an invalid ${field}.`);
  }
}

export function parseReleaseManifest(value: unknown): ReleaseManifest {
  if (!value || typeof value !== "object" || Reflect.get(value, "format") !== 1) {
    throw new Error("The OvertChat release manifest is invalid.");
  }
  const cliVersion = Reflect.get(value, "cliVersion");
  const appVersion = Reflect.get(value, "appVersion");
  const voiceVersion = Reflect.get(value, "voiceVersion");
  const connectorVersion = Reflect.get(value, "connectorVersion");
  const sttVersion = Reflect.get(value, "sttVersion");
  const sandboxVersion = Reflect.get(value, "sandboxVersion");
  const redisImage = Reflect.get(value, "redisImage");
  const searxngImage = Reflect.get(value, "searxngImage");
  const kokoroImage = Reflect.get(value, "kokoroImage");
  const kokoroGpuImage = Reflect.get(value, "kokoroGpuImage");
  const kokoroGpuBlackwellImage = Reflect.get(
    value,
    "kokoroGpuBlackwellImage",
  );
  const cloudTunnelImage = Reflect.get(value, "cloudTunnelImage");
  const cloudProxyImage = Reflect.get(value, "cloudProxyImage");
  assertVersion(cliVersion, "CLI version");
  assertVersion(appVersion, "app version");
  assertVersion(voiceVersion, "voice version");
  assertVersion(connectorVersion, "connector version");
  assertVersion(sttVersion, "STT version");
  assertVersion(sandboxVersion, "code sandbox version");
  assertDigestImage(redisImage, "Redis image", "docker.io/library/redis");
  assertDigestImage(searxngImage, "SearXNG image", "docker.io/searxng/searxng");
  assertDigestImage(
    kokoroImage,
    "Kokoro image",
    "ghcr.io/remsky/kokoro-fastapi-cpu",
  );
  assertDigestImage(
    kokoroGpuImage,
    "Kokoro GPU image",
    "ghcr.io/remsky/kokoro-fastapi-gpu",
  );
  assertDigestImage(
    kokoroGpuBlackwellImage,
    "Kokoro Blackwell image",
    "ghcr.io/remsky/kokoro-fastapi-gpu",
  );
  assertDigestImage(cloudTunnelImage, "OvertChat Cloud tunnel image", "ghcr.io/fatedier/frpc");
  assertDigestImage(cloudProxyImage, "OvertChat Cloud proxy image", "docker.io/library/caddy");
  return {
    format: 1,
    cliVersion,
    appVersion,
    voiceVersion,
    connectorVersion,
    sttVersion,
    sandboxVersion,
    redisImage,
    searxngImage,
    kokoroImage,
    kokoroGpuImage,
    kokoroGpuBlackwellImage,
    cloudTunnelImage,
    cloudProxyImage,
  };
}

export async function latestReleaseManifest(): Promise<ReleaseManifest> {
  const url =
    process.env.OVERTCHAT_RELEASE_MANIFEST_URL?.trim() || RELEASE_MANIFEST_URL;
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not check for OvertChat updates (HTTP ${response.status}).`);
  }
  return parseReleaseManifest(await response.json());
}

function checksumFor(contents: string, asset: string): string {
  for (const line of contents.split(/\r?\n/u)) {
    const [checksum, filename] = line.trim().split(/\s+/u);
    if (filename?.replace(/^\*/u, "") === asset && checksum) return checksum;
  }
  throw new Error(`The CLI checksum for ${asset} is missing.`);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Could not download ${url} (HTTP ${response.status}).`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function currentExecutable(): string | null {
  const executable = process.execPath;
  const basename = path.basename(executable);
  return basename === "overtchat" || basename === "overtchat.exe" || /^overtchat-(?:(?:linux|darwin)-(?:amd64|arm64)|windows-amd64\.exe)$/u.test(basename)
    ? executable
    : null;
}

export async function recoverInterruptedCliUpdate(): Promise<string | null> {
  const executable = currentExecutable();
  if (!executable) return null;
  const lock = await ProcessLock.acquire(`${executable}.update.lock`);
  try {
    const transaction = new BinaryUpdate(executable);
    if (await transaction.pending()) {
      if (!transaction.committed) {
        await transaction.restore();
        await transaction.finish();
        return executable;
      }
      await transaction.finish();
    }
    if (process.platform === "win32") {
      const directory = path.dirname(executable);
      // Images that BinaryUpdate.restore renamed aside while they were running.
      const prefix = `${path.basename(executable)}.abandoned-`;
      for (const file of await readdir(directory)) {
        if (!file.startsWith(prefix) || !/^[0-9a-f-]{36}$/u.test(file.slice(prefix.length))) continue;
        await rm(path.join(directory, file)).catch((error: NodeJS.ErrnoException) => {
          if (!["ENOENT", "EPERM", "EBUSY", "EACCES", "EFAULT"].includes(error.code || "")) throw error;
        });
      }
    }
    return null;
  } finally { await lock.release(); }
}

// The bootstrap downloads and verifies this executable, then delegates the
// installation to it. This also repairs a missing entry point after a killed
// Windows self-update, using the same journal and locks as ordinary updates.
export async function installDownloadedCli(): Promise<void> {
  const executable = path.join(installationBinDirectory(), executableName("overtchat"));
  if (path.resolve(executable) === path.resolve(process.execPath))
    throw new Error("Run the installer to install the manager from a downloaded candidate.");
  const lock = await ProcessLock.acquire(`${executable}.update.lock`);
  const transaction = new BinaryUpdate(executable);
  try {
    if (await transaction.pending()) {
      if (!transaction.committed) await transaction.restore();
      await transaction.finish();
      if (await transaction.pending()) throw new Error("The previous manager is still exiting. Retry the installer shortly.");
    }
    const installed = await runCommand(executable, ["version"]).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (installed?.exitCode === 0 && /^\d+\.\d+\.\d+$/u.test(installed.stdout.trim()) &&
        compareVersions(installed.stdout.trim(), CLI_VERSION) > 0) return;
    await transaction.prepare(process.execPath);
    await transaction.replace();
    await transaction.commit();
  } catch (error) {
    if (await transaction.pending() && !transaction.committed) {
      try { await transaction.restore(); await transaction.finish(); }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError], `Manager installation and recovery failed. Preserve ${transaction.backup} and rerun the installer.`);
      }
    }
    throw error;
  } finally { await lock.release(); }
}

export async function updateCliIfNeeded(
  manifest: ReleaseManifest,
): Promise<string | null> {
  if (compareVersions(manifest.cliVersion, CLI_VERSION) <= 0) return null;
  const executable = currentExecutable();
  // Source/development runs use node, tsx, or bun. Never overwrite those.
  if (!executable) return null;

  const lock = await ProcessLock.acquire(`${executable}.update.lock`);
  try { return await updateCliLocked(manifest, executable); }
  finally { await lock.release(); }
}

async function updateCliLocked(manifest: ReleaseManifest, executable: string): Promise<string> {
  const transaction = new BinaryUpdate(executable);
  if (await transaction.pending()) {
    if (!transaction.committed) await transaction.restore();
    await transaction.finish();
    // A locked committed backup belongs to a still-running previous CLI.
    if (await transaction.pending()) throw new Error("The previous manager is still exiting. Retry the update shortly.");
  }
  const asset = releaseAsset("overtchat");
  const releaseBase = `https://github.com/${CONNECTOR_REPOSITORY}/releases/download/cli-v${manifest.cliVersion}`;
  const temporaryDirectory = await mkdtemp(
    path.join(path.dirname(executable), ".overtchat-update-"),
  );
  const replacement = path.join(temporaryDirectory, executableName("overtchat"));
  try {
    const [binary, checksums] = await Promise.all([
      download(`${releaseBase}/${asset}`),
      download(`${releaseBase}/overtchat-checksums.txt`),
    ]);
    const expected = checksumFor(new TextDecoder().decode(checksums), asset);
    const actual = createHash("sha256").update(binary).digest("hex");
    if (actual !== expected) {
      throw new Error("The downloaded OvertChat CLI failed checksum verification.");
    }
    await writeFile(replacement, binary, { mode: 0o755 });
    await chmod(replacement, 0o755);
    const preflight = await runCommand(replacement, ["version"]);
    if (
      preflight.exitCode !== 0 ||
      preflight.stdout.trim() !== manifest.cliVersion
    ) {
      throw new Error("The downloaded OvertChat CLI failed its startup check.");
    }
    await transaction.prepare(replacement);
    await transaction.replace();
    await transaction.commit();
    return executable;
  } catch (error) {
    if (await transaction.pending() && !transaction.committed) {
      try { await transaction.restore(); await transaction.finish(); }
      catch (recoveryError) {
        throw new AggregateError([error, recoveryError], `CLI update failed. Recovery state is retained at ${transaction.journal}. Rerun the installer to restore the CLI entry point, then retry.`);
      }
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
