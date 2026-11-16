import { describe, expect, it } from "vitest";
import {
  emptyTaskDraft,
  localDate,
  scheduleOfDraft,
  taskDraftOf,
  taskDraftProblem,
  type ScheduledTask,
  type TaskSchedule,
} from "@overtchat/shared";

const NOW = new Date(2026, 10, 30, 22, 0);
const task = (schedule: TaskSchedule): ScheduledTask => ({
  id: "t",
  name: "Morning news",
  prompt: "Summarize the news.",
  modelConfigId: "one",
  projectId: null,
  webSearchEnabled: false,
  schedule,
  timeZone: "Europe/Berlin",
  enabled: true,
  pausedReason: null,
  nextRunAt: null,
  lastRun: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("a task draft", () => {
  it("starts as every day at nine, with tomorrow ready for a one-time task", () => {
    expect(localDate(NOW)).toBe("2026-11-30");
    const draft = emptyTaskDraft("one", "Asia/Kolkata", NOW);
    expect(draft).toMatchObject({
      frequency: "daily",
      time: "09:00",
      date: "2026-12-01",
      timeZone: "Asia/Kolkata",
      webSearchEnabled: true,
    });
    expect(scheduleOfDraft(draft)).toEqual({ frequency: "daily", hour: 9, minute: 0 });
  });

  it("round-trips every kind of schedule through the form", () => {
    const schedules: TaskSchedule[] = [
      { frequency: "once", date: "2027-01-05", hour: 18, minute: 30 },
      { frequency: "hourly", minute: 45 },
      { frequency: "daily", hour: 0, minute: 5 },
      { frequency: "weekdays", hour: 8, minute: 0 },
      { frequency: "weekly", daysOfWeek: [0, 3], hour: 7, minute: 15 },
      { frequency: "monthly", dayOfMonth: 31, hour: 23, minute: 59 },
    ];
    for (const schedule of schedules) {
      const draft = taskDraftOf(task(schedule), NOW);
      expect(scheduleOfDraft(draft)).toEqual(schedule);
      expect(taskDraftProblem(draft)).toBeNull();
      expect(draft).toMatchObject({
        name: "Morning news",
        modelConfigId: "one",
        timeZone: "Europe/Berlin",
        webSearchEnabled: false,
      });
    }
  });

  it("leaves the model empty when the task's model was deleted", () => {
    const draft = taskDraftOf({ ...task({ frequency: "hourly", minute: 0 }), modelConfigId: null }, NOW);
    expect(taskDraftProblem(draft)).toBe("Choose a model.");
  });

  it("names the first thing that stops a save", () => {
    const draft = { ...emptyTaskDraft("one", "UTC", NOW), name: "Task", prompt: "Do it." };
    expect(taskDraftProblem(draft)).toBeNull();
    expect(taskDraftProblem({ ...draft, name: "  " })).toBe("Give the task a name.");
    expect(taskDraftProblem({ ...draft, prompt: "" })).toBe("Say what the task should do.");
    expect(taskDraftProblem({ ...draft, time: "" })).toBe("Choose a time.");
    expect(taskDraftProblem({ ...draft, frequency: "weekly", daysOfWeek: [] })).toBe(
      "Choose at least one day.",
    );
    expect(taskDraftProblem({ ...draft, frequency: "once", date: "" })).toBe(
      "Choose a date and a time.",
    );
    // An hourly task has no time of day to be missing.
    expect(taskDraftProblem({ ...draft, frequency: "hourly", time: "" })).toBeNull();
  });
});
