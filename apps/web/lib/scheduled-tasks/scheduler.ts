import "server-only";
import {
  claimDueRuns,
  claimManualRun,
  closeInterruptedRuns,
  pruneScheduledTaskRuns,
  type ClaimedRun,
} from "@/lib/db/scheduledTasks";

/** How often the clock looks for tasks whose time has come. */
const DEFAULT_TICK_MS = 30_000;
/** Scheduled runs in flight at once; the rest wait for the next tick. */
export const SCHEDULED_TASK_CONCURRENCY = 3;
/** Old runs are dropped about once an hour. */
const PRUNE_EVERY_MS = 60 * 60_000;

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  /** Runs this process is carrying out, scheduled or asked for. */
  active: Set<string>;
  prunedAt: number;
}

// One clock per process, however many times the module is loaded: the
// server's startup code and its routes are built apart.
const globalForScheduler = globalThis as typeof globalThis & {
  overtchatScheduledTasks?: SchedulerState;
};
const state = (globalForScheduler.overtchatScheduledTasks ??= {
  timer: null,
  active: new Set(),
  prunedAt: 0,
});

type Runner = (claim: ClaimedRun) => Promise<void>;

/**
 * Carries a run out through the chat pipeline. That pipeline is loaded when
 * the first run starts, so a server nobody has scheduled anything on starts
 * as fast, and stays as small, as it did before.
 */
const runScheduledTask: Runner = async (claim) => {
  const { runScheduledTask: run } = await import("@/lib/scheduled-tasks/runner");
  await run(claim);
};

function start(claim: ClaimedRun, run: Runner): void {
  state.active.add(claim.runId);
  void run(claim)
    .catch((error) => console.error("[scheduled-tasks] run failed", error))
    .finally(() => state.active.delete(claim.runId));
}

/**
 * One look at the clock: starts every task whose time has come, up to the
 * number of runs this process may have in flight.
 */
export function tickScheduledTasks(
  now = new Date(),
  run: Runner = runScheduledTask,
): ClaimedRun[] {
  const claims = claimDueRuns(
    now,
    Math.max(0, SCHEDULED_TASK_CONCURRENCY - state.active.size),
  );
  for (const claim of claims) start(claim, run);
  if (now.getTime() - state.prunedAt >= PRUNE_EVERY_MS) {
    state.prunedAt = now.getTime();
    pruneScheduledTaskRuns(now);
  }
  return claims;
}

/** Starts a run the owner asked for now, and returns it. */
export function runScheduledTaskNow(
  id: string,
  userId: string,
  run: Runner = runScheduledTask,
): ClaimedRun {
  const claim = claimManualRun(id, userId);
  start(claim, run);
  return claim;
}

function tickMs(): number {
  const configured = Number(process.env.OVERTCHAT_SCHEDULED_TASKS_TICK_MS);
  return Number.isFinite(configured) && configured >= 100
    ? configured
    : DEFAULT_TICK_MS;
}

/**
 * Starts the clock. Runs a previous process left open are closed first:
 * nothing is still writing them.
 */
export function startScheduledTasks(): void {
  if (state.timer) return;
  const interrupted = closeInterruptedRuns();
  if (interrupted > 0) {
    console.log(
      `[scheduled-tasks] Closed ${interrupted} run(s) the last shutdown interrupted.`,
    );
  }
  const loop = () => {
    try {
      tickScheduledTasks();
    } catch (error) {
      console.error("[scheduled-tasks] tick failed", error);
    }
    state.timer = setTimeout(loop, tickMs());
    state.timer.unref?.();
  };
  state.timer = setTimeout(loop, tickMs());
  state.timer.unref?.();
}

/** Stops the clock. Runs in flight finish. */
export function stopScheduledTasks(): void {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
}
