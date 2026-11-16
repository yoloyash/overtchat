import { Cron } from "croner";
import type { TaskSchedule } from "@overtchat/shared";

/** Whether the runtime knows a name as an IANA time zone. */
export function isTimeZone(value: string): boolean {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const two = (value: number) => String(value).padStart(2, "0");

/**
 * A schedule as the cron expression, or the single local time, that croner
 * evaluates in the task's time zone.
 */
function pattern(schedule: TaskSchedule): string {
  switch (schedule.frequency) {
    case "once":
      return `${schedule.date}T${two(schedule.hour)}:${two(schedule.minute)}:00`;
    case "hourly":
      return `${schedule.minute} * * * *`;
    case "daily":
      return `${schedule.minute} ${schedule.hour} * * *`;
    case "weekdays":
      return `${schedule.minute} ${schedule.hour} * * 1-5`;
    case "weekly":
      return `${schedule.minute} ${schedule.hour} * * ${schedule.daysOfWeek.join(",")}`;
    case "monthly":
      return `${schedule.minute} ${schedule.hour} ${schedule.dayOfMonth} * *`;
  }
}

/**
 * The next times a schedule asks for after a moment, earliest first. A local
 * time that a clock change skips runs once the gap is over, and one that it
 * repeats runs the first time only. A month without the chosen day is passed
 * over. A one-time schedule has no times once its moment has gone.
 */
export function nextRunsAfter(
  schedule: TaskSchedule,
  timeZone: string,
  after: Date,
  count: number,
): Date[] {
  const cron = new Cron(pattern(schedule), { timezone: timeZone, paused: true });
  return cron.nextRuns(count, after);
}

export function nextRunAfter(
  schedule: TaskSchedule,
  timeZone: string,
  after: Date,
): Date | null {
  return nextRunsAfter(schedule, timeZone, after, 1)[0] ?? null;
}

/**
 * A moment as local ISO 8601 with its offset in a time zone, such as
 * 2026-11-17T09:00:00+09:00, which a model reads without converting.
 */
export function formatInTimeZone(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return (
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` +
    `${sign}${two(Math.floor(absolute / 60))}:${two(absolute % 60)}`
  );
}
