import type { TFunction } from "i18next";
import {
  parseTaskSchedule,
  type ScheduledTask,
  type ScheduledTaskActivityRun,
  type TaskSchedule,
  type TaskScheduleFrequency,
} from "./scheduled-tasks";

/**
 * What the web and mobile clients share to show and edit scheduled tasks: the
 * form's draft, and the reading of which runs are new.
 */

/** A task as the form holds it: every field at once, whatever the frequency. */
export interface ScheduledTaskDraft {
  name: string;
  prompt: string;
  modelConfigId: string;
  frequency: TaskScheduleFrequency;
  /** 24-hour HH:MM. */
  time: string;
  /** YYYY-MM-DD, for a one-time task. */
  date: string;
  /** Minute past the hour, for an hourly task. */
  minute: number;
  daysOfWeek: number[];
  dayOfMonth: number;
  timeZone: string;
  webSearchEnabled: boolean;
  /** The project runs start in; null for none. */
  projectId: string | null;
}

const two = (value: number) => String(value).padStart(2, "0");

/** The calendar date `days` after `now`, on the reader's own clock. */
export function localDate(now: Date, days = 0): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** A new task: every day at nine, on the reader's clock. */
export function emptyTaskDraft(
  modelConfigId: string,
  timeZone: string,
  now = new Date(),
): ScheduledTaskDraft {
  return {
    name: "",
    prompt: "",
    modelConfigId,
    frequency: "daily",
    time: "09:00",
    date: localDate(now, 1),
    minute: 0,
    daysOfWeek: [1],
    dayOfMonth: 1,
    timeZone,
    webSearchEnabled: true,
    projectId: null,
  };
}

export function taskDraftOf(
  task: ScheduledTask,
  now = new Date(),
): ScheduledTaskDraft {
  const schedule = task.schedule;
  const base = emptyTaskDraft(task.modelConfigId ?? "", task.timeZone, now);
  return {
    ...base,
    name: task.name,
    prompt: task.prompt,
    webSearchEnabled: task.webSearchEnabled,
    projectId: task.projectId,
    frequency: schedule.frequency,
    ...(schedule.frequency === "hourly"
      ? { minute: schedule.minute }
      : { time: `${two(schedule.hour)}:${two(schedule.minute)}` }),
    ...(schedule.frequency === "once" ? { date: schedule.date } : {}),
    ...(schedule.frequency === "weekly"
      ? { daysOfWeek: schedule.daysOfWeek }
      : {}),
    ...(schedule.frequency === "monthly"
      ? { dayOfMonth: schedule.dayOfMonth }
      : {}),
  };
}

/** The schedule a draft describes, or null while a field is missing. */
export function scheduleOfDraft(draft: ScheduledTaskDraft): TaskSchedule | null {
  const match = /^(\d{2}):(\d{2})$/.exec(draft.time);
  return parseTaskSchedule({
    frequency: draft.frequency,
    hour: match ? Number(match[1]) : undefined,
    minute:
      draft.frequency === "hourly"
        ? draft.minute
        : match
          ? Number(match[2])
          : undefined,
    date: draft.date,
    daysOfWeek: draft.daysOfWeek,
    dayOfMonth: draft.dayOfMonth,
  });
}

/** What stops a draft from being saved, in words; null when nothing does. */
export function taskDraftProblem(
  draft: ScheduledTaskDraft,
  t: TFunction,
): string | null {
  if (!draft.name.trim()) return t("scheduled.validation.missingName");
  if (!draft.prompt.trim()) return t("scheduled.validation.missingPrompt");
  if (!draft.modelConfigId) return t("scheduled.validation.missingModel");
  if (draft.frequency === "weekly" && draft.daysOfWeek.length === 0) {
    return t("scheduled.validation.missingDay");
  }
  if (!scheduleOfDraft(draft)) {
    return draft.frequency === "once"
      ? t("scheduled.validation.missingDateAndTime")
      : t("scheduled.validation.missingTime");
  }
  return null;
}

/** Changes whenever a run starts, ends or is opened. */
export function scheduledActivitySignature(runs: readonly ScheduledTaskActivityRun[]): string {
  return runs
    .map((run) => `${run.runId}:${run.status}`)
    .sort()
    .join("|");
}

/** Chats that finished runs wrote and the owner has not opened. */
export function unreadRunChatIds(
  runs: readonly ScheduledTaskActivityRun[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const run of runs ?? []) {
    if (run.chatId && run.status !== "running") ids.add(run.chatId);
  }
  return ids;
}

/**
 * When a run happened or is due, on the task's own clock. The zone is named
 * when it is not the reader's.
 */
export function formatScheduledRunTime(
  timestamp: number,
  timeZone: string,
  locale: string,
): string {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    ...(timeZone === own ? {} : { timeZoneName: "short" }),
  }).format(new Date(timestamp));
}
