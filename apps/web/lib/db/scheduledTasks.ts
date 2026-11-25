import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  SCHEDULED_TASK_ACTIVE_LIMIT,
  type ScheduledTask,
  type ScheduledTaskActivityRun,
  type ScheduledTaskInput,
  type ScheduledTaskPatch,
  type ScheduledTaskRun,
  type ScheduledTaskRunStatus,
  type ScheduledTaskRunTrigger,
} from "@overtchat/shared";
import { db } from "@/lib/db/client";
import { failChatStream } from "@/lib/db/chatTurns";
import { isSelectableChatModel } from "@/lib/db/modelPreferences";
import {
  chats,
  modelConfigs,
  projects,
  scheduledTaskRuns,
  scheduledTasks,
} from "@/lib/db/schema";
import { nextRunAfter } from "@/lib/scheduled-tasks/schedule";

export type ScheduledTaskRow = typeof scheduledTasks.$inferSelect;
export type ScheduledTaskRunRow = typeof scheduledTaskRuns.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A time this late is passed over rather than run. One-time tasks still run. */
export const SCHEDULED_TASK_MISFIRE_GRACE_MS = 15 * 60_000;
/** Scheduled runs that may fail in a row before the task is switched off. */
export const SCHEDULED_TASK_FAILURE_LIMIT = 5;
/** How long a run stays in a task's history. */
export const SCHEDULED_TASK_RUN_RETENTION_MS = 90 * 24 * 60 * 60_000;

export const RUN_ERROR_MISSED =
  "Missed: the server was not running at the scheduled time.";
export const RUN_ERROR_OVERLAP = "Skipped: the previous run was still going.";
export const RUN_ERROR_RESTART = "The server restarted during this run.";

/** A request the owner can fix, with the HTTP status that says how. */
export class ScheduledTaskError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "ScheduledTaskError";
  }
}

const ACTIVE_LIMIT_MESSAGE = `You can have ${SCHEDULED_TASK_ACTIVE_LIMIT} scheduled tasks switched on at a time. Pause or delete one first.`;
const PAST_MESSAGE = "That time has already passed. Choose a later one.";
const MODEL_MESSAGE = "Choose a model that is available for chat.";

export function toScheduledTaskRun(row: ScheduledTaskRunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.taskId,
    chatId: row.chatId,
    trigger: row.trigger,
    status: row.status,
    error: row.error,
    scheduledFor: row.scheduledFor.getTime(),
    startedAt: row.startedAt.getTime(),
    finishedAt: row.finishedAt?.getTime() ?? null,
    seen: row.seenAt !== null,
  };
}

function latestRun(tx: Tx | typeof db, taskId: string): ScheduledTaskRunRow | null {
  return (
    tx
      .select()
      .from(scheduledTaskRuns)
      .where(eq(scheduledTaskRuns.taskId, taskId))
      .orderBy(desc(scheduledTaskRuns.startedAt), sql`${scheduledTaskRuns}.rowid DESC`)
      .limit(1)
      .get() ?? null
  );
}

export function toScheduledTask(
  row: ScheduledTaskRow,
  lastRun: ScheduledTaskRunRow | null,
): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    modelConfigId: row.modelConfigId,
    projectId: row.projectId,
    webSearchEnabled: row.webSearchEnabled,
    schedule: row.schedule,
    timeZone: row.timeZone,
    enabled: row.enabled,
    pausedReason: row.pausedReason,
    nextRunAt: row.nextRunAt?.getTime() ?? null,
    lastRun: lastRun ? toScheduledTaskRun(lastRun) : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function listScheduledTasks(userId: string): ScheduledTask[] {
  return db
    .select()
    .from(scheduledTasks)
    .where(eq(scheduledTasks.userId, userId))
    .orderBy(asc(scheduledTasks.createdAt), asc(scheduledTasks.id))
    .all()
    .map((row) => toScheduledTask(row, latestRun(db, row.id)));
}

export function getScheduledTaskRow(
  id: string,
  userId: string,
): ScheduledTaskRow | null {
  return (
    db
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.userId, userId)))
      .get() ?? null
  );
}

export function getScheduledTask(id: string, userId: string): ScheduledTask | null {
  const row = getScheduledTaskRow(id, userId);
  return row ? toScheduledTask(row, latestRun(db, row.id)) : null;
}

/** What the user calls the model a task runs on, while it still exists. */
export function scheduledTaskModelLabel(
  modelConfigId: string | null,
): string | undefined {
  if (!modelConfigId) return undefined;
  return db
    .select({ label: modelConfigs.label })
    .from(modelConfigs)
    .where(eq(modelConfigs.id, modelConfigId))
    .get()?.label;
}

/** The name of the project a task runs in, while it still exists. */
export function scheduledTaskProjectName(
  projectId: string | null,
): string | undefined {
  if (!projectId) return undefined;
  return db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()?.name;
}

/** The owner's projects, for a task to be put in one by name. */
export function scheduledTaskProjects(
  userId: string,
): { id: string; name: string }[] {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(projects.name)
    .all();
}

function activeCount(tx: Tx, userId: string, exceptId?: string): number {
  return (
    tx
      .select({ count: sql<number>`count(*)` })
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.userId, userId),
          eq(scheduledTasks.enabled, true),
          ...(exceptId ? [ne(scheduledTasks.id, exceptId)] : []),
        ),
      )
      .get()?.count ?? 0
  );
}

function ownsProject(tx: Tx, userId: string, projectId: string): boolean {
  return Boolean(
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .get(),
  );
}

/** Creates a task that is on, with its first run time. `input` is validated. */
export function createScheduledTask(
  userId: string,
  input: ScheduledTaskInput,
  now = new Date(),
): ScheduledTask {
  return db.transaction((tx) => {
    if (!isSelectableChatModel(tx, input.modelConfigId)) {
      throw new ScheduledTaskError(MODEL_MESSAGE);
    }
    if (input.projectId && !ownsProject(tx, userId, input.projectId)) {
      throw new ScheduledTaskError("Project not found.", 404);
    }
    if (activeCount(tx, userId) >= SCHEDULED_TASK_ACTIVE_LIMIT) {
      throw new ScheduledTaskError(ACTIVE_LIMIT_MESSAGE, 409);
    }
    const nextRunAt = nextRunAfter(input.schedule, input.timeZone, now);
    if (!nextRunAt) throw new ScheduledTaskError(PAST_MESSAGE);
    const row = tx
      .insert(scheduledTasks)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: input.name,
        prompt: input.prompt,
        modelConfigId: input.modelConfigId,
        projectId: input.projectId ?? null,
        webSearchEnabled: input.webSearchEnabled ?? true,
        schedule: input.schedule,
        timeZone: input.timeZone,
        enabled: true,
        nextRunAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return toScheduledTask(row, null);
  });
}

/**
 * Applies the owner's edit. Turning a task on, or changing when an enabled
 * task runs, works out its next run from now; turning it off clears it.
 */
export function updateScheduledTask(
  id: string,
  userId: string,
  patch: ScheduledTaskPatch,
  now = new Date(),
): ScheduledTask {
  return db.transaction((tx) => {
    const current = tx
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.userId, userId)))
      .get();
    if (!current) throw new ScheduledTaskError("Scheduled task not found.", 404);

    if (
      patch.modelConfigId !== undefined &&
      patch.modelConfigId !== current.modelConfigId &&
      !isSelectableChatModel(tx, patch.modelConfigId)
    ) {
      throw new ScheduledTaskError(MODEL_MESSAGE);
    }
    if (
      patch.projectId &&
      patch.projectId !== current.projectId &&
      !ownsProject(tx, userId, patch.projectId)
    ) {
      throw new ScheduledTaskError("Project not found.", 404);
    }

    const schedule = patch.schedule ?? current.schedule;
    const timeZone = patch.timeZone ?? current.timeZone;
    const modelConfigId = patch.modelConfigId ?? current.modelConfigId;
    const enabled = patch.enabled ?? current.enabled;
    const turningOn = enabled && !current.enabled;
    const rescheduled =
      patch.schedule !== undefined || patch.timeZone !== undefined;

    let nextRunAt = current.nextRunAt;
    if (!enabled) {
      nextRunAt = null;
    } else if (turningOn || rescheduled) {
      if (turningOn) {
        if (!modelConfigId || !isSelectableChatModel(tx, modelConfigId)) {
          throw new ScheduledTaskError(MODEL_MESSAGE);
        }
        if (activeCount(tx, userId, id) >= SCHEDULED_TASK_ACTIVE_LIMIT) {
          throw new ScheduledTaskError(ACTIVE_LIMIT_MESSAGE, 409);
        }
      }
      nextRunAt = nextRunAfter(schedule, timeZone, now);
      if (!nextRunAt) throw new ScheduledTaskError(PAST_MESSAGE);
    }

    const row = tx
      .update(scheduledTasks)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
        ...(patch.webSearchEnabled !== undefined
          ? { webSearchEnabled: patch.webSearchEnabled }
          : {}),
        modelConfigId,
        schedule,
        timeZone,
        enabled,
        nextRunAt,
        // The owner's own choice replaces whatever the server recorded.
        ...(patch.enabled !== undefined || turningOn
          ? { pausedReason: null, failureCount: 0 }
          : {}),
        updatedAt: now,
      })
      .where(eq(scheduledTasks.id, id))
      .returning()
      .get();
    return toScheduledTask(row, latestRun(tx, id));
  });
}

export function deleteScheduledTask(id: string, userId: string): boolean {
  return (
    db
      .delete(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.userId, userId)))
      .run().changes > 0
  );
}

/** A run the scheduler has recorded and must now carry out. */
export interface ClaimedRun {
  runId: string;
  trigger: ScheduledTaskRunTrigger;
  scheduledFor: Date;
  task: ScheduledTaskRow;
}

function hasRunningRun(tx: Tx, taskId: string): boolean {
  return Boolean(
    tx
      .select({ id: scheduledTaskRuns.id })
      .from(scheduledTaskRuns)
      .where(
        and(
          eq(scheduledTaskRuns.taskId, taskId),
          eq(scheduledTaskRuns.status, "running"),
        ),
      )
      .get(),
  );
}

/**
 * Records a run for every task whose time has come and moves each task on to
 * its next time, in one transaction, so a time is claimed exactly once. At
 * most `capacity` runs start; a task past that stays due for the next tick.
 * A time more than the grace period late, or one that arrives while the
 * task's previous run is still going, is recorded as skipped.
 */
export function claimDueRuns(now: Date, capacity: number): ClaimedRun[] {
  return db.transaction((tx) => {
    const due = tx
      .select()
      .from(scheduledTasks)
      .where(
        and(
          eq(scheduledTasks.enabled, true),
          lte(scheduledTasks.nextRunAt, now),
        ),
      )
      .orderBy(asc(scheduledTasks.nextRunAt), asc(scheduledTasks.id))
      .limit(200)
      .all();
    const claimed: ClaimedRun[] = [];

    for (const task of due) {
      const scheduledFor = task.nextRunAt;
      if (!scheduledFor) continue;
      const once = task.schedule.frequency === "once";
      const late =
        !once &&
        now.getTime() - scheduledFor.getTime() > SCHEDULED_TASK_MISFIRE_GRACE_MS;
      const skipped = late
        ? RUN_ERROR_MISSED
        : hasRunningRun(tx, task.id)
          ? RUN_ERROR_OVERLAP
          : null;
      if (!skipped && claimed.length >= capacity) continue;

      const runId = crypto.randomUUID();
      const inserted = tx
        .insert(scheduledTaskRuns)
        .values({
          id: runId,
          taskId: task.id,
          userId: task.userId,
          trigger: "schedule",
          status: skipped ? "skipped" : "running",
          error: skipped,
          scheduledFor,
          startedAt: now,
          finishedAt: skipped ? now : null,
          // Nothing to open: a skipped run has no chat.
          seenAt: skipped ? now : null,
        })
        .onConflictDoNothing()
        .run();

      const nextRunAt = once
        ? null
        : nextRunAfter(task.schedule, task.timeZone, now);
      tx.update(scheduledTasks)
        .set({
          nextRunAt,
          // A one-time task is done once it has been claimed.
          ...(nextRunAt ? {} : { enabled: false }),
        })
        .where(eq(scheduledTasks.id, task.id))
        .run();

      if (!skipped && inserted.changes > 0) {
        claimed.push({
          runId,
          trigger: "schedule",
          scheduledFor,
          task: { ...task, nextRunAt, enabled: nextRunAt !== null },
        });
      }
    }
    return claimed;
  });
}

/** Records a run the owner asked for now. It leaves the schedule alone. */
export function claimManualRun(
  id: string,
  userId: string,
  now = new Date(),
): ClaimedRun {
  return db.transaction((tx) => {
    const task = tx
      .select()
      .from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.userId, userId)))
      .get();
    if (!task) throw new ScheduledTaskError("Scheduled task not found.", 404);
    if (hasRunningRun(tx, id)) {
      throw new ScheduledTaskError("This task is already running.", 409);
    }
    const runId = crypto.randomUUID();
    tx.insert(scheduledTaskRuns)
      .values({
        id: runId,
        taskId: id,
        userId,
        trigger: "manual",
        status: "running",
        scheduledFor: now,
        startedAt: now,
      })
      .run();
    return { runId, trigger: "manual", scheduledFor: now, task };
  });
}

/** Links a run to the chat it is about to write. */
export function setRunChat(runId: string, chatId: string): void {
  db.update(scheduledTaskRuns)
    .set({ chatId })
    .where(eq(scheduledTaskRuns.id, runId))
    .run();
}

export interface RunOutcome {
  status: Exclude<ScheduledTaskRunStatus, "running">;
  error?: string;
  /** The task cannot run again as it is; switch it off and say why. */
  pause?: string;
}

/**
 * Closes a run and updates its task: a failed scheduled run counts toward
 * the limit that switches the task off, and a finished one clears the count.
 * Returns the reason when this run switched the task off.
 */
export function finishRun(
  runId: string,
  outcome: RunOutcome,
  now = new Date(),
): { paused: string | null } {
  return db.transaction((tx) => {
    const run = tx
      .update(scheduledTaskRuns)
      .set({
        status: outcome.status,
        error: outcome.error ?? null,
        finishedAt: now,
      })
      .where(
        and(
          eq(scheduledTaskRuns.id, runId),
          eq(scheduledTaskRuns.status, "running"),
        ),
      )
      .returning()
      .get();
    if (!run) return { paused: null };
    // A run that left no chat has nothing for the owner to open.
    if (!run.chatId) {
      tx.update(scheduledTaskRuns)
        .set({ seenAt: now })
        .where(eq(scheduledTaskRuns.id, runId))
        .run();
    }

    const task = tx
      .select()
      .from(scheduledTasks)
      .where(eq(scheduledTasks.id, run.taskId))
      .get();
    if (!task) return { paused: null };

    let failureCount = task.failureCount;
    if (outcome.status === "success") failureCount = 0;
    else if (outcome.status === "error" && run.trigger === "schedule") {
      failureCount += 1;
    }
    const paused =
      outcome.pause ??
      (task.enabled && failureCount >= SCHEDULED_TASK_FAILURE_LIMIT
        ? `Paused after ${failureCount} failed runs in a row.`
        : null);
    tx.update(scheduledTasks)
      .set({
        failureCount,
        ...(paused
          ? { enabled: false, nextRunAt: null, pausedReason: paused }
          : {}),
      })
      .where(eq(scheduledTasks.id, task.id))
      .run();
    return { paused };
  });
}

/**
 * Closes the runs a previous process left open, and the generation each one
 * was writing. Called once at startup, before the clock starts.
 */
export function closeInterruptedRuns(now = new Date()): number {
  const open = db
    .select({
      id: scheduledTaskRuns.id,
      chatId: scheduledTaskRuns.chatId,
    })
    .from(scheduledTaskRuns)
    .where(eq(scheduledTaskRuns.status, "running"))
    .all();
  for (const run of open) {
    finishRun(run.id, { status: "interrupted", error: RUN_ERROR_RESTART }, now);
    if (!run.chatId) continue;
    const chat = db
      .select({ activeStreamId: chats.activeStreamId })
      .from(chats)
      .where(eq(chats.id, run.chatId))
      .get();
    if (chat?.activeStreamId) {
      failChatStream({
        chatId: run.chatId,
        streamId: chat.activeStreamId,
        error: RUN_ERROR_RESTART,
      });
    }
  }
  return open.length;
}

export function listScheduledTaskRuns(
  taskId: string,
  userId: string,
  limit = 50,
): ScheduledTaskRun[] {
  return db
    .select()
    .from(scheduledTaskRuns)
    .where(
      and(
        eq(scheduledTaskRuns.taskId, taskId),
        eq(scheduledTaskRuns.userId, userId),
      ),
    )
    .orderBy(desc(scheduledTaskRuns.startedAt), sql`${scheduledTaskRuns}.rowid DESC`)
    .limit(limit)
    .all()
    .map(toScheduledTaskRun);
}

export function getScheduledTaskRun(
  runId: string,
  userId: string,
): ScheduledTaskRun | null {
  const row = db
    .select()
    .from(scheduledTaskRuns)
    .where(
      and(eq(scheduledTaskRuns.id, runId), eq(scheduledTaskRuns.userId, userId)),
    )
    .get();
  return row ? toScheduledTaskRun(row) : null;
}

/** Runs still going, and finished ones whose chat the owner has not opened. */
export function listScheduledTaskActivity(
  userId: string,
): ScheduledTaskActivityRun[] {
  return db
    .select({
      runId: scheduledTaskRuns.id,
      taskId: scheduledTaskRuns.taskId,
      taskName: scheduledTasks.name,
      chatId: scheduledTaskRuns.chatId,
      status: scheduledTaskRuns.status,
      finishedAt: scheduledTaskRuns.finishedAt,
    })
    .from(scheduledTaskRuns)
    .innerJoin(scheduledTasks, eq(scheduledTaskRuns.taskId, scheduledTasks.id))
    .where(
      and(
        eq(scheduledTaskRuns.userId, userId),
        or(
          eq(scheduledTaskRuns.status, "running"),
          and(
            isNull(scheduledTaskRuns.seenAt),
            isNotNull(scheduledTaskRuns.chatId),
          ),
        ),
      ),
    )
    .orderBy(desc(scheduledTaskRuns.startedAt))
    .limit(100)
    .all()
    .map((row) => ({ ...row, finishedAt: row.finishedAt?.getTime() ?? null }));
}

/** The owner opened a chat: its finished runs are no longer new. */
export function markScheduledRunsSeen(
  userId: string,
  chatId: string,
  now = new Date(),
): number {
  return db
    .update(scheduledTaskRuns)
    .set({ seenAt: now })
    .where(
      and(
        eq(scheduledTaskRuns.userId, userId),
        eq(scheduledTaskRuns.chatId, chatId),
        isNull(scheduledTaskRuns.seenAt),
        ne(scheduledTaskRuns.status, "running"),
      ),
    )
    .run().changes;
}

/** Drops runs older than the history window. Their chats are kept. */
export function pruneScheduledTaskRuns(now = new Date()): number {
  return db
    .delete(scheduledTaskRuns)
    .where(
      and(
        lt(
          scheduledTaskRuns.startedAt,
          new Date(now.getTime() - SCHEDULED_TASK_RUN_RETENTION_MS),
        ),
        inArray(scheduledTaskRuns.status, [
          "success",
          "error",
          "skipped",
          "interrupted",
        ]),
      ),
    )
    .run().changes;
}
