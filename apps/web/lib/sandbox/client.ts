import "server-only";
import type { CodeExecutionCapability } from "@overtchat/shared";

/** What the sandbox reports about itself at /healthz. */
export interface SandboxInfo {
  tier: string;
  version: string;
  packages: Record<string, string>;
  tools: string[];
  skills: Array<{ name: string; description: string; path: string }>;
  limits: {
    timeout_seconds: number;
    max_timeout_seconds: number;
    max_input_bytes: number;
    max_output_files: number;
    max_output_bytes: number;
  };
}

export type SandboxStatus =
  | { state: "not-installed" }
  | { state: "unreachable"; error: string }
  | { state: "available"; info: SandboxInfo };

export interface SandboxFile {
  name: string;
  data: string;
}

export interface SandboxRunResult {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  duration_ms: number;
  stdout: string;
  stdout_truncated: boolean;
  stderr: string;
  stderr_truncated: boolean;
  files: Array<{
    path: string;
    name: string;
    size: number;
    media_type: string;
    data: string;
  }>;
  skipped_files: Array<{ path: string; reason: string }>;
}

export class SandboxError extends Error {}

const HEALTH_TIMEOUT_MS = 3_000;
const AVAILABLE_TTL_MS = 60_000;
const UNAVAILABLE_TTL_MS = 10_000;

let cached: { status: SandboxStatus; expires: number } | undefined;
let pending: Promise<SandboxStatus> | undefined;

function sandboxUrl(): string | null {
  const url = process.env.SANDBOX_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

function headers(): Record<string, string> {
  const token = process.env.SANDBOX_TOKEN?.trim();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Installed when the operator points the app at a sandbox (SANDBOX_URL). */
export function isSandboxInstalled(): boolean {
  return Boolean(sandboxUrl());
}

async function probe(): Promise<SandboxStatus> {
  const url = sandboxUrl();
  if (!url) return { state: "not-installed" };
  try {
    const response = await fetch(`${url}/healthz`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Partial<
      SandboxInfo & { status: string; error: string }
    >;
    if (!response.ok || body.status !== "ok") {
      return {
        state: "unreachable",
        error: body.error ?? `The sandbox health check returned HTTP ${response.status}.`,
      };
    }
    return {
      state: "available",
      info: {
        tier: typeof body.tier === "string" ? body.tier : "slim",
        version: typeof body.version === "string" ? body.version : "unknown",
        packages: body.packages && typeof body.packages === "object" ? body.packages : {},
        tools: Array.isArray(body.tools) ? body.tools.filter((tool) => typeof tool === "string") : [],
        skills: Array.isArray(body.skills)
          ? body.skills.filter(
              (skill) =>
                typeof skill?.name === "string" &&
                typeof skill.description === "string" &&
                typeof skill.path === "string",
            )
          : [],
        limits: {
          timeout_seconds: 60,
          max_timeout_seconds: 300,
          max_input_bytes: 100 * 1024 * 1024,
          max_output_files: 20,
          max_output_bytes: 50 * 1024 * 1024,
          ...(body.limits ?? {}),
        },
      },
    };
  } catch (error) {
    return {
      state: "unreachable",
      error: error instanceof Error ? error.message : "The sandbox is unreachable.",
    };
  }
}

/**
 * Sandbox health, cached briefly so chat requests do not each probe it.
 * `fresh` probes now and updates the cache.
 */
export async function getSandboxStatus({ fresh = false } = {}): Promise<SandboxStatus> {
  if (!fresh && cached && cached.expires > Date.now()) return cached.status;
  pending ??= probe().then((status) => {
    cached = {
      status,
      expires:
        Date.now() +
        (status.state === "available" ? AVAILABLE_TTL_MS : UNAVAILABLE_TTL_MS),
    };
    pending = undefined;
    return status;
  });
  return pending;
}

/** Forget the cached status, for example after a failed run. */
export function invalidateSandboxStatus(): void {
  cached = undefined;
}

/** Reported fresh, so starting or stopping the sandbox shows immediately. */
export async function getCodeExecutionCapability(): Promise<CodeExecutionCapability> {
  const status = await getSandboxStatus({ fresh: true });
  if (status.state === "available") {
    return {
      installed: true,
      available: true,
      tier: status.info.tier,
      unavailableReason: null,
    };
  }
  return {
    installed: status.state !== "not-installed",
    available: false,
    unavailableReason: status.state,
  };
}

export async function runInSandbox(
  request: { code: string; files: SandboxFile[]; timeoutSeconds?: number },
  signal?: AbortSignal,
): Promise<SandboxRunResult> {
  const url = sandboxUrl();
  if (!url) throw new SandboxError("Code execution is not configured.");
  let response: Response;
  try {
    response = await fetch(`${url}/run`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        code: request.code,
        language: "python",
        files: request.files,
        ...(request.timeoutSeconds ? { timeout_seconds: request.timeoutSeconds } : {}),
      }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    signal?.throwIfAborted();
    invalidateSandboxStatus();
    throw new SandboxError(
      `The code sandbox is unreachable${error instanceof Error ? `: ${error.message}` : "."}`,
    );
  }
  const body = (await response.json().catch(() => null)) as
    | (SandboxRunResult & { error?: string })
    | null;
  if (!response.ok || !body) {
    if (response.status >= 500) invalidateSandboxStatus();
    throw new SandboxError(
      body?.error ?? `The code sandbox returned HTTP ${response.status}.`,
    );
  }
  return body;
}

/** Test seam: reset the module cache between cases. */
export function resetSandboxStatusForTests(): void {
  cached = undefined;
  pending = undefined;
}
