import type { ToolState } from "./tools";

/**
 * A scheduled task runs one prompt on a schedule, with nobody at the
 * keyboard. Every run is a new chat, so a task's history is a list of chats.
 */

export const TASK_SCHEDULE_FREQUENCIES = [
  "once",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "monthly",
] as const;
export type TaskScheduleFrequency = (typeof TASK_SCHEDULE_FREQUENCIES)[number];

/**
 * When a task runs, as wall-clock fields in the task's own time zone. Days of
 * the week count from Sunday as 0.
 */
export type TaskSchedule =
  | { frequency: "once"; date: string; hour: number; minute: number }
  | { frequency: "hourly"; minute: number }
  | { frequency: "daily"; hour: number; minute: number }
  | { frequency: "weekdays"; hour: number; minute: number }
  | { frequency: "weekly"; daysOfWeek: number[]; hour: number; minute: number }
  | { frequency: "monthly"; dayOfMonth: number; hour: number; minute: number };

export const SCHEDULED_TASK_NAME_LIMIT = 100;
export const SCHEDULED_TASK_PROMPT_LIMIT = 32_000;
/** How many tasks one person may have switched on at a time. */
export const SCHEDULED_TASK_ACTIVE_LIMIT = 10;

function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/** A calendar date that exists, as YYYY-MM-DD. */
function calendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? value
    : null;
}

/**
 * A schedule as it is stored: only the fields its frequency uses, in a fixed
 * shape. Null for anything that is not a schedule.
 */
export function parseTaskSchedule(value: unknown): TaskSchedule | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const minute = wholeNumber(input.minute, 0, 59);
  if (minute === null) return null;
  if (input.frequency === "hourly") return { frequency: "hourly", minute };

  const hour = wholeNumber(input.hour, 0, 23);
  if (hour === null) return null;
  switch (input.frequency) {
    case "once": {
      const date = calendarDate(input.date);
      return date ? { frequency: "once", date, hour, minute } : null;
    }
    case "daily":
      return { frequency: "daily", hour, minute };
    case "weekdays":
      return { frequency: "weekdays", hour, minute };
    case "weekly": {
      if (!Array.isArray(input.daysOfWeek)) return null;
      const days = [...new Set(input.daysOfWeek)];
      if (
        days.length === 0 ||
        days.some((day) => wholeNumber(day, 0, 6) === null)
      ) {
        return null;
      }
      return {
        frequency: "weekly",
        daysOfWeek: (days as number[]).sort((a, b) => a - b),
        hour,
        minute,
      };
    }
    case "monthly": {
      const dayOfMonth = wholeNumber(input.dayOfMonth, 1, 31);
      return dayOfMonth === null
        ? null
        : { frequency: "monthly", dayOfMonth, hour, minute };
    }
    default:
      return null;
  }
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A wall-clock time the way the reader's locale writes it. */
export function formatTaskTime(
  hour: number,
  minute: number,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
}

/** A schedule in words, such as "Weekdays at 9:00 AM". */
export function describeTaskSchedule(
  schedule: TaskSchedule,
  locale?: string,
): string {
  if (schedule.frequency === "hourly") {
    return schedule.minute === 0
      ? "Every hour"
      : `Every hour at :${String(schedule.minute).padStart(2, "0")}`;
  }
  const time = formatTaskTime(schedule.hour, schedule.minute, locale);
  switch (schedule.frequency) {
    case "once": {
      const [year, month, day] = schedule.date.split("-").map(Number);
      const date = new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, day)));
      return `Once on ${date} at ${time}`;
    }
    case "daily":
      return `Every day at ${time}`;
    case "weekdays":
      return `Weekdays at ${time}`;
    case "weekly":
      return schedule.daysOfWeek.length === 7
        ? `Every day at ${time}`
        : `Every ${list(schedule.daysOfWeek.map((day) => DAY_NAMES[day]))} at ${time}`;
    case "monthly":
      return `Monthly on the ${ordinal(schedule.dayOfMonth)} at ${time}`;
  }
}

export const SCHEDULED_TASK_RUN_STATUSES = [
  "running",
  "success",
  "error",
  "skipped",
  "interrupted",
] as const;
export type ScheduledTaskRunStatus =
  (typeof SCHEDULED_TASK_RUN_STATUSES)[number];

/** What each run status is called in a task's history. */
export const SCHEDULED_TASK_RUN_LABELS: Record<ScheduledTaskRunStatus, string> =
  {
    running: "Running",
    success: "Finished",
    error: "Failed",
    skipped: "Skipped",
    interrupted: "Stopped",
  };

export const SCHEDULED_TASK_RUN_TRIGGERS = ["schedule", "manual"] as const;
export type ScheduledTaskRunTrigger =
  (typeof SCHEDULED_TASK_RUN_TRIGGERS)[number];

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  /** The chat the run wrote, unless it never started one or it was deleted. */
  chatId: string | null;
  trigger: ScheduledTaskRunTrigger;
  status: ScheduledTaskRunStatus;
  /** Why a run failed, was skipped or stopped. */
  error: string | null;
  /** The time the schedule asked for, or when Run now was pressed. */
  scheduledFor: number;
  startedAt: number;
  finishedAt: number | null;
  /** The owner has opened the run's chat. */
  seen: boolean;
}

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  /** Null once the model it was given has been deleted. */
  modelConfigId: string | null;
  /** The project each run's chat is filed in, when there is one. */
  projectId: string | null;
  webSearchEnabled: boolean;
  schedule: TaskSchedule;
  /** IANA time zone the schedule's wall-clock fields are in. */
  timeZone: string;
  enabled: boolean;
  /** Why the server switched the task off, when it did. */
  pausedReason: string | null;
  /** Null while the task is off, and once a one-time task has run. */
  nextRunAt: number | null;
  lastRun: ScheduledTaskRun | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskListResponse {
  tasks: ScheduledTask[];
  /** How many tasks may be switched on at once. */
  activeLimit: number;
}

export interface ScheduledTaskInput {
  name: string;
  prompt: string;
  modelConfigId: string;
  schedule: TaskSchedule;
  timeZone: string;
  webSearchEnabled?: boolean;
  projectId?: string | null;
}

export type ScheduledTaskPatch = Partial<ScheduledTaskInput> & {
  enabled?: boolean;
};

/** A run whose chat the owner has not opened yet, or that is still going. */
export interface ScheduledTaskActivityRun {
  runId: string;
  taskId: string;
  taskName: string;
  chatId: string | null;
  status: ScheduledTaskRunStatus;
  finishedAt: number | null;
}

export interface ScheduledTaskActivityResponse {
  runs: ScheduledTaskActivityRun[];
}

/** Whether a one-time task has had its run and has nothing left to do. */
export function scheduledTaskIsCompleted(
  task: Pick<ScheduledTask, "schedule" | "enabled" | "lastRun" | "pausedReason">,
): boolean {
  return (
    task.schedule.frequency === "once" &&
    !task.enabled &&
    task.pausedReason === null &&
    task.lastRun !== null
  );
}

/** Tools of the scheduled tasks skill, in deterministic order. */
export const SCHEDULED_TASK_TOOL_NAMES = [
  "list_scheduled_tasks",
  "create_scheduled_task",
  "update_scheduled_task",
  "delete_scheduled_task",
] as const;
export type ScheduledTaskToolName = (typeof SCHEDULED_TASK_TOOL_NAMES)[number];

/** A task as the skill's tools report it to a model, and to the chat. */
export interface ScheduledTaskToolTask {
  id: string;
  name: string;
  prompt: string;
  /** The schedule in words. */
  schedule: string;
  timeZone: string;
  enabled: boolean;
  /** ISO 8601 with the task's own offset. */
  nextRuns: string[];
  model?: string;
  /** The project its runs start in, when it has one. */
  project?: string;
}

export interface ScheduledTaskToolOutput {
  /** The task created, changed or deleted. */
  task?: ScheduledTaskToolTask;
  tasks?: ScheduledTaskToolTask[];
  deleted?: boolean;
}

export type ScheduledTaskToolPart = {
  type: `tool-${ScheduledTaskToolName}`;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const SCHEDULED_TASK_PART_TYPES: ReadonlySet<string> = new Set(
  SCHEDULED_TASK_TOOL_NAMES.map((name) => `tool-${name}`),
);

export function isScheduledTaskToolPart(part: {
  type: string;
}): part is ScheduledTaskToolPart {
  return SCHEDULED_TASK_PART_TYPES.has(part.type);
}

function toolOutput(part: ScheduledTaskToolPart): ScheduledTaskToolOutput | null {
  return part.state === "output-available" &&
    part.output !== null &&
    typeof part.output === "object"
    ? (part.output as ScheduledTaskToolOutput)
    : null;
}

/** The task a create, update or delete step acted on, once it has. */
export function scheduledTaskOfToolPart(
  part: ScheduledTaskToolPart,
): ScheduledTaskToolTask | null {
  const task = toolOutput(part)?.task;
  return task && typeof task.name === "string" ? task : null;
}

/** Whether a reply created, changed or deleted a scheduled task. */
export function hasScheduledTaskChange(message: {
  parts: readonly { type: string }[];
}): boolean {
  return message.parts.some(
    (part) =>
      isScheduledTaskToolPart(part) &&
      part.type !== "tool-list_scheduled_tasks" &&
      scheduledTaskOfToolPart(part) !== null,
  );
}

/** What the activity line says for one scheduled tasks step. */
export function scheduledTaskActivityLabel(
  part: ScheduledTaskToolPart,
  active: boolean,
): string {
  const action = part.type.slice("tool-".length) as ScheduledTaskToolName;
  if (active) {
    return {
      list_scheduled_tasks: "Checking scheduled tasks…",
      create_scheduled_task: "Scheduling a task…",
      update_scheduled_task: "Updating a scheduled task…",
      delete_scheduled_task: "Deleting a scheduled task…",
    }[action];
  }
  const output = toolOutput(part);
  if (!output) {
    return {
      list_scheduled_tasks: "Could not check scheduled tasks",
      create_scheduled_task: "Could not schedule the task",
      update_scheduled_task: "Could not update the task",
      delete_scheduled_task: "Could not delete the task",
    }[action];
  }
  const name = scheduledTaskOfToolPart(part)?.name;
  switch (action) {
    case "list_scheduled_tasks": {
      const count = Array.isArray(output.tasks) ? output.tasks.length : 0;
      return count === 1
        ? "Checked 1 scheduled task"
        : `Checked ${count} scheduled tasks`;
    }
    case "create_scheduled_task":
      return name ? `Scheduled “${name}”` : "Scheduled a task";
    case "update_scheduled_task":
      return name ? `Updated “${name}”` : "Updated a scheduled task";
    case "delete_scheduled_task":
      return name ? `Deleted “${name}”` : "Deleted a scheduled task";
  }
}
