import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedRun } from "@/lib/db/scheduledTasks";
import { createTestDatabase } from "./test-database";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => fixture);
const runner = vi.hoisted(() => ({ runScheduledTask: vi.fn() }));
vi.mock("@/lib/scheduled-tasks/runner", () => runner);
const { raw, db, reset } = createTestDatabase();
fixture.db = db;
const store = await import("@/lib/db/scheduledTasks");
const {
  SCHEDULED_TASK_CONCURRENCY,
  runScheduledTaskNow,
  startScheduledTasks,
  stopScheduledTasks,
  tickScheduledTasks,
} = await import("./scheduler");

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-16T12:00:00Z");
const make = (name = "Task") =>
  store.createScheduledTask(
    "a",
    {
      name,
      prompt: "Do it.",
      modelConfigId: "one",
      schedule: { frequency: "hourly", minute: 0 },
      timeZone: "UTC",
    },
    NOW,
  );

/** A runner the test finishes by hand. */
function heldRunner() {
  const held: { claim: ClaimedRun; finish: () => void }[] = [];
  const run = (claim: ClaimedRun) =>
    new Promise<void>((resolve) => {
      held.push({
        claim,
        finish: () => {
          store.finishRun(claim.runId, { status: "success" });
          resolve();
        },
      });
    });
  return { held, run };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});
afterEach(() => {
  stopScheduledTasks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the scheduler", () => {
  it("starts due tasks and keeps to its share of runs in flight", async () => {
    for (let index = 0; index < SCHEDULED_TASK_CONCURRENCY + 2; index += 1) make();
    const { held, run } = heldRunner();

    expect(tickScheduledTasks(at("2026-11-16T12:59:00Z"), run)).toEqual([]);
    expect(tickScheduledTasks(at("2026-11-16T13:00:01Z"), run)).toHaveLength(
      SCHEDULED_TASK_CONCURRENCY,
    );
    // Full: the rest wait, still due.
    expect(tickScheduledTasks(at("2026-11-16T13:00:31Z"), run)).toEqual([]);

    held[0].finish();
    await settle();
    expect(tickScheduledTasks(at("2026-11-16T13:01:01Z"), run)).toHaveLength(1);
    for (const run of held.slice(1)) run.finish();
    await settle();
    expect(tickScheduledTasks(at("2026-11-16T13:01:31Z"), run)).toHaveLength(1);
    held.at(-1)?.finish();
    await settle();
  });

  it("frees its place when a run throws", async () => {
    for (let index = 0; index < SCHEDULED_TASK_CONCURRENCY + 1; index += 1) make();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = vi.fn(async (claim: ClaimedRun) => {
      store.finishRun(claim.runId, { status: "error", error: "Boom." });
      throw new Error("Boom.");
    });
    expect(tickScheduledTasks(at("2026-11-16T13:00:01Z"), failing)).toHaveLength(
      SCHEDULED_TASK_CONCURRENCY,
    );
    await settle();
    expect(tickScheduledTasks(at("2026-11-16T13:00:31Z"), failing)).toHaveLength(1);
    await settle();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("runs a task by hand beside the schedule, and counts it against the share", async () => {
    const tasks = Array.from({ length: SCHEDULED_TASK_CONCURRENCY }, () => make());
    const { held, run } = heldRunner();
    const claim = runScheduledTaskNow(tasks[0].id, "a", run);
    expect(claim.trigger).toBe("manual");
    expect(() => runScheduledTaskNow(tasks[0].id, "a", run)).toThrow(
      "This task is already running.",
    );
    expect(() => runScheduledTaskNow(tasks[0].id, "b", run)).toThrow(
      "Scheduled task not found.",
    );

    // Two places left; the task already running is skipped, not queued.
    const claims = tickScheduledTasks(at("2026-11-16T13:00:01Z"), run);
    expect(claims.map((item) => item.task.id).sort()).toEqual(
      tasks.slice(1).map((task) => task.id).sort(),
    );
    expect(store.listScheduledTaskRuns(tasks[0].id, "a")[0]).toMatchObject({
      status: "skipped",
      error: store.RUN_ERROR_OVERLAP,
    });
    for (const item of held) item.finish();
    await settle();
  });

  it("drops old history about once an hour", () => {
    const task = make();
    const { run } = heldRunner();
    const [claim] = tickScheduledTasks(at("2026-11-16T13:00:01Z"), run);
    store.finishRun(claim.runId, { status: "success" }, at("2026-11-16T13:00:02Z"));
    store.updateScheduledTask(task.id, "a", { enabled: false });

    const later = at("2027-03-01T00:00:00Z");
    tickScheduledTasks(later, run);
    expect(store.listScheduledTaskRuns(task.id, "a")).toEqual([]);
  });

  it("closes runs the last process left open, then ticks on its own clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("OVERTCHAT_SCHEDULED_TASKS_TICK_MS", "1000");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const task = make();
    const orphan = store.claimManualRun(task.id, "a", NOW);
    runner.runScheduledTask.mockImplementation(async (claim: ClaimedRun) => {
      store.finishRun(claim.runId, { status: "success" });
    });

    startScheduledTasks();
    startScheduledTasks();
    expect(store.getScheduledTaskRun(orphan.runId, "a")).toMatchObject({
      status: "interrupted",
      error: store.RUN_ERROR_RESTART,
    });
    expect(log).toHaveBeenCalledOnce();

    vi.setSystemTime(at("2026-11-16T13:00:00Z"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(runner.runScheduledTask).toHaveBeenCalledOnce();
    expect(runner.runScheduledTask.mock.calls[0][0]).toMatchObject({
      trigger: "schedule",
      task: { id: task.id },
    });

    stopScheduledTasks();
    vi.setSystemTime(at("2026-11-16T14:00:00Z"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.runScheduledTask).toHaveBeenCalledOnce();
    log.mockRestore();
    expect(raw.prepare("SELECT count(*) AS n FROM scheduled_task_runs").get()).toEqual({ n: 2 });
  });
});
