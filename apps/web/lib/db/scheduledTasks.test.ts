import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCHEDULED_TASK_ACTIVE_LIMIT,
  type ScheduledTaskInput,
} from "@overtchat/shared";
import { createTestDatabase } from "@/lib/scheduled-tasks/test-database";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => fixture);
const { raw, db, reset } = createTestDatabase();
fixture.db = db;
const tasks = await import("./scheduledTasks");
const {
  claimDueRuns,
  claimManualRun,
  closeInterruptedRuns,
  createScheduledTask,
  deleteScheduledTask,
  finishRun,
  getScheduledTask,
  listScheduledTaskActivity,
  listScheduledTaskRuns,
  listScheduledTasks,
  markScheduledRunsSeen,
  pruneScheduledTaskRuns,
  ScheduledTaskError,
  setRunChat,
  updateScheduledTask,
} = tasks;

const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-16T12:00:00Z");
const daily = (over: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput => ({
  name: "Morning news",
  prompt: "Summarize today's news.",
  modelConfigId: "one",
  schedule: { frequency: "daily", hour: 9, minute: 0 },
  timeZone: "UTC",
  ...over,
});
const status = (error: unknown) =>
  error instanceof ScheduledTaskError ? error.status : null;
const failure = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return { status: status(error), message: (error as Error).message };
  }
  throw new Error("Expected a failure.");
};

beforeEach(reset);

describe("creating a task", () => {
  it("switches it on with its first run time", () => {
    const task = createScheduledTask("a", daily({ projectId: "p" }), NOW);
    expect(task).toMatchObject({
      name: "Morning news",
      enabled: true,
      pausedReason: null,
      webSearchEnabled: true,
      projectId: "p",
      lastRun: null,
      nextRunAt: at("2026-11-17T09:00:00Z").getTime(),
    });
    expect(listScheduledTasks("a").map((item) => item.id)).toEqual([task.id]);
    expect(listScheduledTasks("b")).toEqual([]);
    expect(getScheduledTask(task.id, "b")).toBeNull();
  });

  it("refuses a model that cannot chat, another person's project, and a past time", () => {
    for (const modelConfigId of ["hidden", "image", "missing"]) {
      expect(failure(() => createScheduledTask("a", daily({ modelConfigId }), NOW))).toEqual({
        status: 400,
        message: "Choose a model that is available for chat.",
      });
    }
    expect(
      failure(() => createScheduledTask("a", daily({ projectId: "other" }), NOW)).status,
    ).toBe(404);
    expect(
      failure(() =>
        createScheduledTask(
          "a",
          daily({ schedule: { frequency: "once", date: "2026-11-16", hour: 11, minute: 0 } }),
          NOW,
        ),
      ),
    ).toEqual({
      status: 400,
      message: "That time has already passed. Choose a later one.",
    });
    expect(listScheduledTasks("a")).toEqual([]);
  });

  it("limits how many are on at once, per person, and frees a place when one is paused", () => {
    const made = Array.from({ length: SCHEDULED_TASK_ACTIVE_LIMIT }, () =>
      createScheduledTask("a", daily(), NOW),
    );
    expect(failure(() => createScheduledTask("a", daily(), NOW)).status).toBe(409);
    expect(createScheduledTask("b", daily(), NOW).enabled).toBe(true);

    updateScheduledTask(made[0].id, "a", { enabled: false }, NOW);
    const extra = createScheduledTask("a", daily(), NOW);
    expect(extra.enabled).toBe(true);
    expect(
      failure(() => updateScheduledTask(made[0].id, "a", { enabled: true }, NOW)).status,
    ).toBe(409);
  });
});

describe("changing a task", () => {
  it("keeps the next run for edits that do not move it", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const later = at("2026-11-16T20:00:00Z");
    const edited = updateScheduledTask(
      task.id,
      "a",
      { name: "Evening news", prompt: "Other.", webSearchEnabled: false, modelConfigId: "two" },
      later,
    );
    expect(edited).toMatchObject({
      name: "Evening news",
      prompt: "Other.",
      webSearchEnabled: false,
      modelConfigId: "two",
      nextRunAt: task.nextRunAt,
      updatedAt: later.getTime(),
    });
  });

  it("works out the next run again when the schedule or time zone changes", () => {
    const task = createScheduledTask("a", daily(), NOW);
    expect(
      updateScheduledTask(
        task.id,
        "a",
        { schedule: { frequency: "hourly", minute: 30 } },
        NOW,
      ).nextRunAt,
    ).toBe(at("2026-11-16T12:30:00Z").getTime());
    expect(
      updateScheduledTask(
        task.id,
        "a",
        { schedule: { frequency: "daily", hour: 9, minute: 0 }, timeZone: "Asia/Kolkata" },
        NOW,
      ).nextRunAt,
    ).toBe(at("2026-11-17T03:30:00Z").getTime());
  });

  it("pauses and resumes, clearing what the server recorded", () => {
    const task = createScheduledTask("a", daily(), NOW);
    raw.prepare(
      "UPDATE scheduled_tasks SET enabled = 0, next_run_at = NULL, paused_reason = 'Paused after 5 failed runs in a row.', failure_count = 5 WHERE id = ?",
    ).run(task.id);
    expect(getScheduledTask(task.id, "a")?.pausedReason).toMatch(/^Paused after/);

    const resumed = updateScheduledTask(task.id, "a", { enabled: true }, NOW);
    expect(resumed).toMatchObject({
      enabled: true,
      pausedReason: null,
      nextRunAt: at("2026-11-17T09:00:00Z").getTime(),
    });
    expect(
      raw.prepare("SELECT failure_count AS n FROM scheduled_tasks WHERE id = ?").get(task.id),
    ).toEqual({ n: 0 });

    const paused = updateScheduledTask(task.id, "a", { enabled: false }, NOW);
    expect(paused).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: null });
  });

  it("will not switch a task on without a usable model or with a time gone by", () => {
    const task = createScheduledTask("a", daily(), NOW);
    updateScheduledTask(task.id, "a", { enabled: false }, NOW);
    raw.exec("DELETE FROM model_configs WHERE id = 'one'");
    expect(getScheduledTask(task.id, "a")?.modelConfigId).toBeNull();
    expect(
      failure(() => updateScheduledTask(task.id, "a", { enabled: true }, NOW)).message,
    ).toBe("Choose a model that is available for chat.");
    expect(
      updateScheduledTask(task.id, "a", { enabled: true, modelConfigId: "two" }, NOW).enabled,
    ).toBe(true);

    const once = createScheduledTask(
      "a",
      daily({
        modelConfigId: "two",
        schedule: { frequency: "once", date: "2026-11-17", hour: 9, minute: 0 },
      }),
      NOW,
    );
    updateScheduledTask(once.id, "a", { enabled: false }, NOW);
    expect(
      failure(() =>
        updateScheduledTask(once.id, "a", { enabled: true }, at("2026-11-18T00:00:00Z")),
      ).message,
    ).toBe("That time has already passed. Choose a later one.");
  });

  it("is the owner's alone", () => {
    const task = createScheduledTask("a", daily(), NOW);
    expect(failure(() => updateScheduledTask(task.id, "b", { name: "Mine" }, NOW)).status).toBe(404);
    expect(failure(() => claimManualRun(task.id, "b")).status).toBe(404);
    expect(deleteScheduledTask(task.id, "b")).toBe(false);
    expect(getScheduledTask(task.id, "a")?.name).toBe("Morning news");
    expect(deleteScheduledTask(task.id, "a")).toBe(true);
    expect(getScheduledTask(task.id, "a")).toBeNull();
  });
});

describe("claiming due runs", () => {
  it("claims a time once and moves the task to its next one", () => {
    const task = createScheduledTask("a", daily(), NOW);
    expect(claimDueRuns(at("2026-11-17T08:59:59Z"), 3)).toEqual([]);

    const due = at("2026-11-17T09:00:10Z");
    const claims = claimDueRuns(due, 3);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      trigger: "schedule",
      scheduledFor: at("2026-11-17T09:00:00Z"),
      task: { id: task.id, enabled: true, nextRunAt: at("2026-11-18T09:00:00Z") },
    });
    expect(claimDueRuns(due, 3)).toEqual([]);
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      nextRunAt: at("2026-11-18T09:00:00Z").getTime(),
      lastRun: { id: claims[0].runId, status: "running", trigger: "schedule", seen: false },
    });
  });

  it("passes over a time more than the grace period late, without a backlog", () => {
    const task = createScheduledTask("a", daily(), NOW);
    // The server was off for three days.
    expect(claimDueRuns(at("2026-11-20T10:00:00Z"), 3)).toEqual([]);
    const runs = listScheduledTaskRuns(task.id, "a");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      status: "skipped",
      error: tasks.RUN_ERROR_MISSED,
      scheduledFor: at("2026-11-17T09:00:00Z").getTime(),
      seen: true,
    });
    expect(getScheduledTask(task.id, "a")?.nextRunAt).toBe(
      at("2026-11-21T09:00:00Z").getTime(),
    );
    expect(listScheduledTaskActivity("a")).toEqual([]);
  });

  it("still runs a time inside the grace period", () => {
    createScheduledTask("a", daily(), NOW);
    expect(
      claimDueRuns(
        new Date(at("2026-11-17T09:00:00Z").getTime() + tasks.SCHEDULED_TASK_MISFIRE_GRACE_MS),
        3,
      ),
    ).toHaveLength(1);
  });

  it("runs a one-time task late, then leaves it finished", () => {
    const task = createScheduledTask(
      "a",
      daily({ schedule: { frequency: "once", date: "2026-11-17", hour: 9, minute: 0 } }),
      NOW,
    );
    const claims = claimDueRuns(at("2026-11-19T00:00:00Z"), 3);
    expect(claims).toHaveLength(1);
    expect(claims[0].task).toMatchObject({ enabled: false, nextRunAt: null });
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: null,
    });
    expect(claimDueRuns(at("2026-11-20T00:00:00Z"), 3)).toEqual([]);
  });

  it("skips a time that arrives while the last run is still going", () => {
    const task = createScheduledTask(
      "a",
      daily({ schedule: { frequency: "hourly", minute: 0 } }),
      NOW,
    );
    const [first] = claimDueRuns(at("2026-11-16T13:00:00Z"), 3);
    expect(claimDueRuns(at("2026-11-16T14:00:00Z"), 3)).toEqual([]);
    expect(listScheduledTaskRuns(task.id, "a")[0]).toMatchObject({
      status: "skipped",
      error: tasks.RUN_ERROR_OVERLAP,
    });

    finishRun(first.runId, { status: "success" }, at("2026-11-16T14:30:00Z"));
    expect(claimDueRuns(at("2026-11-16T15:00:00Z"), 3)).toHaveLength(1);
  });

  it("starts no more than the capacity and leaves the rest due", () => {
    const made = Array.from({ length: 4 }, () => createScheduledTask("a", daily(), NOW));
    const due = at("2026-11-17T09:00:05Z");
    expect(claimDueRuns(due, 0)).toEqual([]);
    const first = claimDueRuns(due, 3);
    expect(first).toHaveLength(3);
    const second = claimDueRuns(at("2026-11-17T09:00:35Z"), 3);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((claim) => claim.task.id))).toEqual(
      new Set(made.map((task) => task.id)),
    );
    expect(second[0].scheduledFor).toEqual(at("2026-11-17T09:00:00Z"));
  });

  it("leaves a paused task alone", () => {
    const task = createScheduledTask("a", daily(), NOW);
    updateScheduledTask(task.id, "a", { enabled: false }, NOW);
    expect(claimDueRuns(at("2026-11-17T09:00:05Z"), 3)).toEqual([]);
    expect(listScheduledTaskRuns(task.id, "a")).toEqual([]);
  });
});

describe("running by hand", () => {
  it("records a run without moving the schedule, even while paused", () => {
    const task = createScheduledTask("a", daily(), NOW);
    updateScheduledTask(task.id, "a", { enabled: false }, NOW);
    const claim = claimManualRun(task.id, "a", NOW);
    expect(claim).toMatchObject({ trigger: "manual", scheduledFor: NOW });
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      enabled: false,
      nextRunAt: null,
      lastRun: { id: claim.runId, trigger: "manual", status: "running" },
    });
    expect(failure(() => claimManualRun(task.id, "a", NOW))).toEqual({
      status: 409,
      message: "This task is already running.",
    });
  });
});

describe("finishing a run", () => {
  const seedChat = (id: string, userId = "a") =>
    raw.prepare("INSERT INTO chats (id, user_id, title) VALUES (?, ?, 'Run')").run(id, userId);

  it("keeps a finished run unread until its chat is opened", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const [claim] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    seedChat("c1");
    setRunChat(claim.runId, "c1");
    expect(listScheduledTaskActivity("a")).toEqual([
      {
        runId: claim.runId,
        taskId: task.id,
        taskName: "Morning news",
        chatId: "c1",
        status: "running",
        finishedAt: null,
      },
    ]);
    // Opening the chat mid-run does not count as reading the result.
    expect(markScheduledRunsSeen("a", "c1")).toBe(0);

    const finished = at("2026-11-17T09:01:00Z");
    expect(finishRun(claim.runId, { status: "success" }, finished)).toEqual({ paused: null });
    expect(listScheduledTaskActivity("a")).toMatchObject([
      { runId: claim.runId, status: "success", finishedAt: finished.getTime() },
    ]);
    expect(listScheduledTaskActivity("b")).toEqual([]);
    expect(markScheduledRunsSeen("b", "c1")).toBe(0);
    expect(markScheduledRunsSeen("a", "c1")).toBe(1);
    expect(listScheduledTaskActivity("a")).toEqual([]);
    expect(listScheduledTaskRuns(task.id, "a")[0]).toMatchObject({
      status: "success",
      chatId: "c1",
      seen: true,
      error: null,
    });
  });

  it("is recorded once", () => {
    createScheduledTask("a", daily(), NOW);
    const [claim] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    finishRun(claim.runId, { status: "interrupted", error: "Stopped by hand." });
    finishRun(claim.runId, { status: "success" });
    expect(listScheduledTaskRuns(claim.task.id, "a")[0]).toMatchObject({
      status: "interrupted",
      error: "Stopped by hand.",
    });
  });

  it("marks a run that wrote no chat as seen, and keeps it when its chat is deleted", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const [failed] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    finishRun(failed.runId, { status: "error", error: "No reply." });
    expect(listScheduledTaskActivity("a")).toEqual([]);

    const [ok] = claimDueRuns(at("2026-11-18T09:00:05Z"), 3);
    seedChat("c2");
    setRunChat(ok.runId, "c2");
    finishRun(ok.runId, { status: "success" });
    raw.exec("DELETE FROM chats WHERE id = 'c2'");
    expect(listScheduledTaskActivity("a")).toEqual([]);
    expect(listScheduledTaskRuns(task.id, "a")).toMatchObject([
      { id: ok.runId, chatId: null, status: "success" },
      { id: failed.runId, chatId: null, status: "error", error: "No reply.", seen: true },
    ]);
  });

  it("switches a task off after five scheduled failures in a row", () => {
    const task = createScheduledTask(
      "a",
      daily({ schedule: { frequency: "hourly", minute: 0 } }),
      NOW,
    );
    const fail = (hour: number) => {
      const [claim] = claimDueRuns(at(`2026-11-16T${hour}:00:05Z`), 3);
      return finishRun(claim.runId, { status: "error", error: "Boom." });
    };
    for (const hour of [13, 14, 15, 16]) expect(fail(hour)).toEqual({ paused: null });
    // A success in between starts the count again.
    const [ok] = claimDueRuns(at("2026-11-16T17:00:05Z"), 3);
    finishRun(ok.runId, { status: "success" });
    for (const hour of [18, 19, 20, 21]) expect(fail(hour)).toEqual({ paused: null });
    // Runs by hand, and runs that were stopped, do not count.
    const manual = claimManualRun(task.id, "a");
    finishRun(manual.runId, { status: "error", error: "Boom." });
    const [stopped] = claimDueRuns(at("2026-11-16T22:00:05Z"), 3);
    finishRun(stopped.runId, { status: "interrupted", error: "Stopped by hand." });
    expect(getScheduledTask(task.id, "a")?.enabled).toBe(true);

    expect(fail(23)).toEqual({ paused: "Paused after 5 failed runs in a row." });
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: "Paused after 5 failed runs in a row.",
    });
    expect(claimDueRuns(at("2026-11-17T00:00:05Z"), 3)).toEqual([]);
  });

  it("switches a task off at once when the run says it cannot go on", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const [claim] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    expect(
      finishRun(claim.runId, { status: "error", error: "Model gone.", pause: "Model gone." }),
    ).toEqual({ paused: "Model gone." });
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      enabled: false,
      nextRunAt: null,
      pausedReason: "Model gone.",
    });
  });
});

describe("after a restart", () => {
  it("closes open runs and the reply each was writing", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const [claim] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    raw.exec(`INSERT INTO chats (id, user_id, title, active_stream_id) VALUES ('c', 'a', 'Run', 's1');
      INSERT INTO chat_generations (id, chat_id, user_id, client_request_id, request_fingerprint, status)
        VALUES ('s1', 'c', 'a', 'scheduled-task-run:x', 'f', 'running');`);
    setRunChat(claim.runId, "c");

    expect(closeInterruptedRuns(at("2026-11-17T09:05:00Z"))).toBe(1);
    expect(closeInterruptedRuns()).toBe(0);
    expect(listScheduledTaskRuns(task.id, "a")[0]).toMatchObject({
      status: "interrupted",
      error: tasks.RUN_ERROR_RESTART,
      finishedAt: at("2026-11-17T09:05:00Z").getTime(),
    });
    expect(raw.prepare("SELECT active_stream_id AS s FROM chats WHERE id = 'c'").get()).toEqual({
      s: null,
    });
    expect(
      raw.prepare("SELECT status, error FROM chat_generations WHERE id = 's1'").get(),
    ).toEqual({ status: "error", error: tasks.RUN_ERROR_RESTART });
    // The task itself carries on.
    expect(getScheduledTask(task.id, "a")).toMatchObject({
      enabled: true,
      nextRunAt: at("2026-11-18T09:00:00Z").getTime(),
    });
  });
});

describe("history", () => {
  it("drops finished runs past the retention window and goes with its task", () => {
    const task = createScheduledTask("a", daily(), NOW);
    const [old] = claimDueRuns(at("2026-11-17T09:00:05Z"), 3);
    finishRun(old.runId, { status: "success" });
    // Months off: the time that was missed is recorded, and nothing starts.
    expect(claimDueRuns(at("2027-02-10T09:00:05Z"), 3)).toEqual([]);
    const [open] = claimDueRuns(at("2027-02-11T09:00:05Z"), 3);

    const later = new Date(
      at("2026-11-17T09:00:05Z").getTime() + tasks.SCHEDULED_TASK_RUN_RETENTION_MS + 1,
    );
    expect(pruneScheduledTaskRuns(later)).toBe(1);
    expect(
      listScheduledTaskRuns(task.id, "a").map((run) => [run.id === open.runId, run.status]),
    ).toEqual([
      [true, "running"],
      [false, "skipped"],
    ]);

    deleteScheduledTask(task.id, "a");
    expect(raw.prepare("SELECT count(*) AS n FROM scheduled_task_runs").get()).toEqual({ n: 0 });
  });
});
