import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExistingInstallation,
  InstallationConfig,
  RuntimePaths,
} from "./types.js";
import {
  APP_VERSION,
  APP_IMAGE,
  CONNECTOR_VERSION,
  DEFAULT_APP_PORT,
  DEFAULT_COMPOSE_PROJECT,
  DEFAULT_DATA_VOLUME,
  STT_VERSION,
} from "./constants.js";

export type InstallationSecrets = {
  betterAuthSecret: string;
  managementSecret: string;
  searxngSecret: string;
};

function generatedSecret(): string {
  return randomBytes(32).toString("hex");
}

function newerVersion(left: string | undefined, right: string): boolean {
  if (!left || !/^\d+\.\d+\.\d+$/u.test(left)) return false;
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  return leftParts.some((value, index) => {
    const previousEqual = leftParts
      .slice(0, index)
      .every((part, partIndex) => part === rightParts[partIndex]);
    return previousEqual && value > (rightParts[index] ?? 0);
  });
}

export function defaultInstallationConfig(
  existing: ExistingInstallation | null,
): InstallationConfig {
  const environment = existing?.environment;
  const searchUrl = environment?.get("SEARXNG_URL");
  const ttsUrl = environment?.get("KOKORO_URL");
  const sttUrl = environment?.get("STT_URL");
  const preserveNewerApp = newerVersion(existing?.appVersion, APP_VERSION);
  const appVersion = preserveNewerApp ? existing!.appVersion! : APP_VERSION;
  const appImage = preserveNewerApp
    ? existing!.appImage!
    : `${APP_IMAGE}:${APP_VERSION}`;
  return {
    format: 1,
    appVersion,
    appImage,
    connectorVersion: CONNECTOR_VERSION,
    sttVersion: STT_VERSION,
    appPort: existing?.appPort ?? DEFAULT_APP_PORT,
    bindAddress: existing?.bindAddress ?? "0.0.0.0",
    publicUrl:
      existing?.publicUrl ?? `http://localhost:${DEFAULT_APP_PORT}`,
    extraTrustedOrigins:
      existing?.environment
        .get("EXTRA_TRUSTED_ORIGINS")
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [],
    connectorServerUrl:
      existing?.environment.get("HOST_CONNECTOR_URL") ??
      `http://127.0.0.1:${existing?.appPort ?? DEFAULT_APP_PORT}`,
    composeProject: existing?.composeProject ?? DEFAULT_COMPOSE_PROJECT,
    dataMountType: existing?.dataMountType ?? "volume",
    dataVolume: existing?.dataVolume ?? DEFAULT_DATA_VOLUME,
    search: searchUrl && searchUrl !== "http://searxng:8080"
      ? { provider: "searxng", bundledInstalled: false, baseUrl: searchUrl }
      : { provider: "bundled", bundledInstalled: true },
    tts: ttsUrl && ttsUrl !== "http://kokoro:8880"
      ? {
          provider: "openai-compatible",
          bundledInstalled: false,
          baseUrl: ttsUrl,
        }
      : { provider: "bundled", bundledInstalled: true },
    stt:
      sttUrl && sttUrl !== "http://stt:5092"
        ? {
            provider: "openai-compatible",
            bundledInstalled: false,
            baseUrl: sttUrl,
          }
        : existing?.sttAccelerator
          ? {
              provider: "bundled",
              bundledInstalled: true,
              accelerator: existing.sttAccelerator,
              gpuUuid: existing.sttGpuUuid,
            }
          : { provider: "disabled", bundledInstalled: false },
    agents: { installed: false },
    ...(existing?.composeWorkingDir
      ? { adoptedFrom: existing.composeWorkingDir }
      : {}),
  };
}

export async function readInstallationConfig(
  paths: RuntimePaths,
): Promise<InstallationConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(paths.stateFile, "utf8")) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Reflect.get(parsed, "format") !== 1
    ) {
      throw new Error(`Unsupported installation state at ${paths.stateFile}.`);
    }
    const config = parsed as InstallationConfig;
    return withoutProviderKeys({
      ...config,
      // State written by the first installer draft only supported volumes.
      dataMountType: config.dataMountType ?? "volume",
      bindAddress: config.bindAddress ?? "0.0.0.0",
      extraTrustedOrigins: config.extraTrustedOrigins ?? [],
      connectorServerUrl:
        config.connectorServerUrl ?? `http://127.0.0.1:${config.appPort}`,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function withoutApiKey<T extends { apiKey?: string }>(
  capability: T,
): Omit<T, "apiKey"> {
  const persisted = { ...capability };
  delete persisted.apiKey;
  return persisted;
}

export function withoutProviderKeys(
  config: InstallationConfig,
): InstallationConfig {
  return {
    ...config,
    search: withoutApiKey(config.search),
    tts: withoutApiKey(config.tts),
    stt: withoutApiKey(config.stt),
  };
}

export function initialSecrets(
  existing: ExistingInstallation | null,
  previous: Partial<InstallationSecrets> = {},
): InstallationSecrets {
  return {
    betterAuthSecret:
      previous.betterAuthSecret ||
      existing?.environment.get("BETTER_AUTH_SECRET") ||
      generatedSecret(),
    managementSecret: previous.managementSecret || generatedSecret(),
    searxngSecret:
      previous.searxngSecret ||
      existing?.environment.get("SEARXNG_SECRET") ||
      generatedSecret(),
  };
}

function parseEnv(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match?.[1]) continue;
    let value = match[2] ?? "";
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        // Preserve the raw value; the next write will normalize it.
      }
    }
    values.set(match[1], value);
  }
  return values;
}

export async function readInstallationSecrets(
  paths: RuntimePaths,
): Promise<Partial<InstallationSecrets>> {
  try {
    const values = parseEnv(await readFile(paths.secretsFile, "utf8"));
    return {
      betterAuthSecret: values.get("BETTER_AUTH_SECRET"),
      managementSecret: values.get("OVERTCHAT_MANAGEMENT_SECRET"),
      searxngSecret: values.get("SEARXNG_SECRET"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeAtomic(
  destination: string,
  contents: string,
  mode: number,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.new-${process.pid}`;
  await writeFile(temporary, contents, { encoding: "utf8", mode });
  await chmod(temporary, mode);
  await rename(temporary, destination);
}

export async function writeInstallationConfig(
  paths: RuntimePaths,
  config: InstallationConfig,
): Promise<void> {
  await writeAtomic(
    paths.stateFile,
    `${JSON.stringify(withoutProviderKeys(config), null, 2)}\n`,
    0o600,
  );
}

export async function writeSecretsFile(
  paths: RuntimePaths,
  contents: string,
): Promise<void> {
  await writeAtomic(paths.secretsFile, contents, 0o600);
}
