import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rename,
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
  connectorVersion: string;
  sttVersion: string;
  redisImage: string;
  searxngImage: string;
  kokoroImage: string;
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
  const sttVersion =
    compareVersions(manifest.sttVersion, config.sttVersion) > 0
      ? manifest.sttVersion
      : config.sttVersion;

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
        : `${VOICE_IMAGE}:${appVersion}`,
    connectorVersion,
    sttVersion,
    redisImage: manifest.redisImage,
    searxngImage: manifest.searxngImage,
    kokoroImage: manifest.kokoroImage,
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
  const connectorVersion = Reflect.get(value, "connectorVersion");
  const sttVersion = Reflect.get(value, "sttVersion");
  const redisImage = Reflect.get(value, "redisImage");
  const searxngImage = Reflect.get(value, "searxngImage");
  const kokoroImage = Reflect.get(value, "kokoroImage");
  assertVersion(cliVersion, "CLI version");
  assertVersion(appVersion, "app version");
  assertVersion(connectorVersion, "connector version");
  assertVersion(sttVersion, "STT version");
  assertDigestImage(redisImage, "Redis image", "docker.io/library/redis");
  assertDigestImage(searxngImage, "SearXNG image", "docker.io/searxng/searxng");
  assertDigestImage(
    kokoroImage,
    "Kokoro image",
    "ghcr.io/remsky/kokoro-fastapi-cpu",
  );
  return {
    format: 1,
    cliVersion,
    appVersion,
    connectorVersion,
    sttVersion,
    redisImage,
    searxngImage,
    kokoroImage,
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

function cliAsset(): string {
  if (process.platform !== "linux") {
    throw new Error("The managed OvertChat CLI currently supports Linux.");
  }
  if (process.arch === "x64") return "overtchat-linux-amd64";
  if (process.arch === "arm64") return "overtchat-linux-arm64";
  throw new Error(`The OvertChat CLI does not support ${process.arch}.`);
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
  return basename === "overtchat" || basename.startsWith("overtchat-linux-")
    ? executable
    : null;
}

export async function updateCliIfNeeded(
  manifest: ReleaseManifest,
): Promise<string | null> {
  if (compareVersions(manifest.cliVersion, CLI_VERSION) <= 0) return null;
  const executable = currentExecutable();
  // Source/development runs use node, tsx, or bun. Never overwrite those.
  if (!executable) return null;

  const asset = cliAsset();
  const releaseBase = `https://github.com/${CONNECTOR_REPOSITORY}/releases/download/cli-v${manifest.cliVersion}`;
  const temporaryDirectory = await mkdtemp(
    path.join(path.dirname(executable), ".overtchat-update-"),
  );
  const replacement = path.join(temporaryDirectory, "overtchat");
  const backup = `${executable}.previous`;
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
    await rm(backup, { force: true });
    await copyFile(executable, backup);
    await rename(replacement, executable);
    return executable;
  } catch (error) {
    if (await readFile(backup).catch(() => null)) {
      await copyFile(backup, executable).catch(() => {});
    }
    throw error;
  } finally {
    await rm(backup, { force: true });
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
