import "server-only";
import { APP_VERSION } from "@/lib/version";

const RELEASE_MANIFEST_URL = "https://overtchat.com/install-manifest.json";
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 5_000;
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/u;

export type AppUpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
};

type CacheEntry = {
  checkedAt: number;
  latestVersion: string | null;
};

let cached: CacheEntry | null = null;
let pending: Promise<string | null> | null = null;

function updateCheckDisabled(): boolean {
  return /^(1|true|yes)$/iu.test(
    process.env.DISABLE_UPDATE_CHECK?.trim() ?? "",
  );
}

function parseVersion(version: string): [number, number, number] | null {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts as [number, number, number];
}

export function isNewerVersion(current: string, candidate: string): boolean {
  const currentParts = parseVersion(current);
  const candidateParts = parseVersion(candidate);
  if (!currentParts || !candidateParts) return false;

  for (let index = 0; index < currentParts.length; index += 1) {
    if (candidateParts[index]! > currentParts[index]!) return true;
    if (candidateParts[index]! < currentParts[index]!) return false;
  }
  return false;
}

function manifestVersion(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const manifest = value as { format?: unknown; appVersion?: unknown };
  if (manifest.format !== 1 || typeof manifest.appVersion !== "string") {
    return null;
  }
  return parseVersion(manifest.appVersion) ? manifest.appVersion.trim() : null;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(RELEASE_MANIFEST_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return manifestVersion(await response.json());
  } catch {
    return null;
  }
}

async function latestVersion(): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.checkedAt < CHECK_INTERVAL_MS) {
    return cached.latestVersion;
  }
  if (pending) return pending;

  pending = fetchLatestVersion()
    .then((version) => {
      cached = { checkedAt: Date.now(), latestVersion: version };
      return version;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function getAppUpdateStatus(): Promise<AppUpdateStatus> {
  const latest = updateCheckDisabled() ? null : await latestVersion();
  return {
    currentVersion: APP_VERSION,
    latestVersion: latest,
    updateAvailable:
      latest !== null && isNewerVersion(APP_VERSION, latest),
  };
}
