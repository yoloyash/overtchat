import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeTaskSchedule,
  hasScheduledTaskChange,
  isScheduledTaskToolPart,
  parseTaskSchedule,
  scheduledTaskActivityLabel,
  scheduledTaskIsCompleted,
  scheduledTaskOfToolPart,
} from "../src/scheduled-tasks.ts";
import { i18n } from "../src/i18n/index.ts";

test("a schedule keeps only the fields its frequency uses", () => {
  assert.deepEqual(
    parseTaskSchedule({ frequency: "hourly", minute: 5, hour: 9, date: "x" }),
    { frequency: "hourly", minute: 5 },
  );
  assert.deepEqual(
    parseTaskSchedule({ frequency: "daily", hour: 9, minute: 0, daysOfWeek: [1] }),
    { frequency: "daily", hour: 9, minute: 0 },
  );
  assert.deepEqual(
    parseTaskSchedule({ frequency: "weekly", hour: 9, minute: 0, daysOfWeek: [5, 1, 5] }),
    { frequency: "weekly", daysOfWeek: [1, 5], hour: 9, minute: 0 },
  );
  assert.deepEqual(
    parseTaskSchedule({ frequency: "monthly", hour: 0, minute: 59, dayOfMonth: 31 }),
    { frequency: "monthly", dayOfMonth: 31, hour: 0, minute: 59 },
  );
  assert.deepEqual(
    parseTaskSchedule({ frequency: "once", date: "2028-02-29", hour: 23, minute: 0 }),
    { frequency: "once", date: "2028-02-29", hour: 23, minute: 0 },
  );
});

test("anything that is not a schedule is refused", () => {
  for (const value of [
    null,
    "daily",
    [],
    {},
    { frequency: "daily", hour: 9 },
    { frequency: "daily", hour: 24, minute: 0 },
    { frequency: "daily", hour: 9, minute: 60 },
    { frequency: "daily", hour: 9.5, minute: 0 },
    { frequency: "daily", hour: "9", minute: 0 },
    { frequency: "minutely", hour: 9, minute: 0 },
    { frequency: "hourly" },
    { frequency: "weekly", hour: 9, minute: 0 },
    { frequency: "weekly", hour: 9, minute: 0, daysOfWeek: [] },
    { frequency: "weekly", hour: 9, minute: 0, daysOfWeek: [7] },
    { frequency: "monthly", hour: 9, minute: 0, dayOfMonth: 0 },
    { frequency: "monthly", hour: 9, minute: 0, dayOfMonth: 32 },
    { frequency: "once", hour: 9, minute: 0 },
    { frequency: "once", hour: 9, minute: 0, date: "2026-02-30" },
    { frequency: "once", hour: 9, minute: 0, date: "17/11/2026" },
  ]) {
    assert.equal(parseTaskSchedule(value), null, JSON.stringify(value));
  }
});

test("a schedule reads in plain words", () => {
  const words = (schedule) => describeTaskSchedule(schedule, i18n.t, "en-US");
  assert.equal(words({ frequency: "hourly", minute: 0 }), "Every hour");
  assert.equal(words({ frequency: "hourly", minute: 5 }), "Every hour at :05");
  assert.equal(words({ frequency: "daily", hour: 9, minute: 0 }), "Every day at 9:00 AM");
  assert.equal(words({ frequency: "weekdays", hour: 17, minute: 30 }), "Weekdays at 5:30 PM");
  assert.equal(
    words({ frequency: "weekly", daysOfWeek: [1], hour: 0, minute: 0 }),
    "Every Monday at 12:00 AM",
  );
  assert.equal(
    words({ frequency: "weekly", daysOfWeek: [1, 3, 5], hour: 8, minute: 0 }),
    "Every Monday, Wednesday and Friday at 8:00 AM",
  );
  assert.equal(
    words({ frequency: "weekly", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], hour: 8, minute: 0 }),
    "Every day at 8:00 AM",
  );
  for (const [day, text] of [
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [31, "31st"],
  ]) {
    assert.equal(
      words({ frequency: "monthly", dayOfMonth: day, hour: 9, minute: 0 }),
      `Monthly on the ${text} at 9:00 AM`,
    );
  }
  assert.equal(
    words({ frequency: "once", date: "2026-11-17", hour: 9, minute: 0 }),
    "Once on Nov 17, 2026 at 9:00 AM",
  );
});

test("a one-time task is completed only after its run, when nothing paused it", () => {
  const once = { frequency: "once", date: "2026-11-17", hour: 9, minute: 0 };
  const run = { id: "r" };
  const task = { schedule: once, enabled: false, lastRun: run, pausedReason: null };
  assert.equal(scheduledTaskIsCompleted(task), true);
  assert.equal(scheduledTaskIsCompleted({ ...task, lastRun: null }), false);
  assert.equal(scheduledTaskIsCompleted({ ...task, enabled: true }), false);
  assert.equal(scheduledTaskIsCompleted({ ...task, pausedReason: "Model gone." }), false);
  assert.equal(
    scheduledTaskIsCompleted({
      ...task,
      schedule: { frequency: "daily", hour: 9, minute: 0 },
    }),
    false,
  );
});

test("a scheduled tasks step says what it did", () => {
  const part = (action, extra) => ({
    type: `tool-${action}`,
    toolCallId: "call",
    state: "output-available",
    ...extra,
  });
  const task = { id: "t", name: "Morning news", schedule: "Every day at 9:00 AM" };

  assert.equal(isScheduledTaskToolPart({ type: "tool-create_scheduled_task" }), true);
  assert.equal(isScheduledTaskToolPart({ type: "tool-web_search" }), false);

  const created = part("create_scheduled_task", { output: { task } });
  assert.equal(scheduledTaskOfToolPart(created).name, "Morning news");
  assert.equal(scheduledTaskActivityLabel(created, false, i18n.t), "Scheduled “Morning news”");
  assert.equal(scheduledTaskActivityLabel(created, true, i18n.t), "Scheduling a task…");
  assert.equal(
    scheduledTaskActivityLabel(part("update_scheduled_task", { output: { task } }), false, i18n.t),
    "Updated “Morning news”",
  );
  assert.equal(
    scheduledTaskActivityLabel(
      part("delete_scheduled_task", { output: { task, deleted: true } }),
      false,
      i18n.t,
    ),
    "Deleted “Morning news”",
  );
  assert.equal(
    scheduledTaskActivityLabel(part("list_scheduled_tasks", { output: { tasks: [task] } }), false, i18n.t),
    "Checked 1 scheduled task",
  );
  assert.equal(
    scheduledTaskActivityLabel(part("list_scheduled_tasks", { output: { tasks: [] } }), false, i18n.t),
    "Checked 0 scheduled tasks",
  );

  // Only a step that changed a task means the list on screen is out of date.
  assert.equal(hasScheduledTaskChange({ parts: [{ type: "text" }, created] }), true);
  assert.equal(
    hasScheduledTaskChange({
      parts: [part("list_scheduled_tasks", { output: { tasks: [task] } })],
    }),
    false,
  );
  assert.equal(
    hasScheduledTaskChange({
      parts: [part("create_scheduled_task", { state: "input-available" })],
    }),
    false,
  );

  const failed = part("create_scheduled_task", { state: "output-error", errorText: "No." });
  assert.equal(scheduledTaskOfToolPart(failed), null);
  assert.equal(scheduledTaskActivityLabel(failed, false, i18n.t), "Could not schedule the task");
});
