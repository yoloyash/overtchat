import { z } from "zod";

import { executeOnHost, type HostTarget } from "@overtchat/agent-runtime/runtime/process";

const LEASE_PROBE_TIMEOUT_MS = 20_000;
const HELD_RECHECK_DELAY_MS = 750;
const reportSchema = z.object({
  held: z.array(z.string()),
  unknown: z.array(z.string()),
});

export type OmpSessionLease = "held" | "free" | "unknown";

/** First OMP release with `omp session lease` and RPC `get_session_lease`. */
const LEASE_COMMAND_SINCE = [18, 14, 1] as const;

/**
 * Whether the detected OMP answers `omp session lease`. Earlier builds either
 * reject the action or, before the `session` command existed, would read the
 * arguments as a prompt, so the probe only runs on a version known to have it.
 */
export function ompSupportsSessionLease(detectedVersion: string | null | undefined): boolean {
  const match = detectedVersion?.match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (!match) return false;
  const version = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < LEASE_COMMAND_SINCE.length; index += 1) {
    if (version[index] !== LEASE_COMMAND_SINCE[index]) return version[index] > LEASE_COMMAND_SINCE[index];
  }
  return true;
}

/**
 * Ask the installed OMP which process owns a session without taking the
 * lease ourselves. OMP keeps one writer per session: a second process that
 * opens a held session continues in a sibling file under a new id, so the
 * answer decides whether a resume can attach at all. Older OMP builds have no
 * `session lease` command and any failure reads as unknown, which lets the
 * resume proceed as before.
 */
export async function probeOmpSessionLease(
  target: HostTarget,
  executable: string,
  cwd: string | undefined,
  sessionId: string,
  options: { heldRecheckDelayMs?: number } = {},
): Promise<OmpSessionLease> {
  const first = await probeOnce(target, executable, cwd, sessionId);
  if (first !== "held") return first;
  // A process of ours that was just stopped (an edit replaces its session)
  // may still be releasing the lock, especially over SSH; only a lease that
  // outlives a short grace period belongs to someone else.
  await new Promise((resolve) => setTimeout(resolve, options.heldRecheckDelayMs ?? HELD_RECHECK_DELAY_MS));
  return probeOnce(target, executable, cwd, sessionId);
}

async function probeOnce(
  target: HostTarget,
  executable: string,
  cwd: string | undefined,
  sessionId: string,
): Promise<OmpSessionLease> {
  try {
    const result = await executeOnHost(
      target,
      { command: executable, args: ["session", "lease", "--json", "--", sessionId], cwd },
      { timeoutMs: LEASE_PROBE_TIMEOUT_MS },
    );
    const report = reportSchema.parse(JSON.parse(result.stdout.trim()));
    if (report.held.includes(sessionId)) return "held";
    if (report.unknown.includes(sessionId)) return "unknown";
    return "free";
  } catch {
    return "unknown";
  }
}
