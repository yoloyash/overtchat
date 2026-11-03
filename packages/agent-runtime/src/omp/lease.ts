import { z } from "zod";

import { executeOnHost, type HostTarget } from "@overtchat/agent-runtime/runtime/process";

const LEASE_PROBE_TIMEOUT_MS = 20_000;
const HELD_RECHECK_DELAY_MS = 750;
const reportSchema = z.object({
  held: z.array(z.string()),
  unknown: z.array(z.string()),
});

export type OmpSessionLease = "held" | "free" | "unknown";

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
