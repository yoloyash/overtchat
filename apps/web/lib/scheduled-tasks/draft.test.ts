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
import { i18n } from "@overtchat/shared/i18n";

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
      projectId: null,
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
      expect(taskDraftProblem(draft, i18n.t)).toBeNull();
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
    // The project a task runs in is part of what the form shows and saves.
    expect(draft.projectId).toBeNull();
    expect(
      taskDraftOf({ ...task({ frequency: "hourly", minute: 0 }), projectId: "p" }, NOW)
        .projectId,
    ).toBe("p");
    expect(taskDraftProblem(draft, i18n.t)).toBe("Choose a model.");
  });

  it("names the first thing that stops a save", () => {
    const draft = { ...emptyTaskDraft("one", "UTC", NOW), name: "Task", prompt: "Do it." };
    expect(taskDraftProblem(draft, i18n.t)).toBeNull();
    expect(taskDraftProblem({ ...draft, name: "  " }, i18n.t)).toBe("Give the task a name.");
    expect(taskDraftProblem({ ...draft, prompt: "" }, i18n.t)).toBe("Say what the task should do.");
    expect(taskDraftProblem({ ...draft, time: "" }, i18n.t)).toBe("Choose a time.");
    expect(taskDraftProblem({ ...draft, frequency: "weekly", daysOfWeek: [] }, i18n.t)).toBe(
      "Choose at least one day.",
    );
    expect(taskDraftProblem({ ...draft, frequency: "once", date: "" }, i18n.t)).toBe(
      "Choose a date and a time.",
    );
    // An hourly task has no time of day to be missing.
    expect(taskDraftProblem({ ...draft, frequency: "hourly", time: "" }, i18n.t)).toBeNull();
  });
});
