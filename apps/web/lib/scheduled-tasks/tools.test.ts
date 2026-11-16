import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduledTaskToolOutput } from "@overtchat/shared";
import { createTestDatabase } from "./test-database";

vi.mock("server-only", () => ({}));
const fixture = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db/client", () => fixture);
const { db, reset } = createTestDatabase();
fixture.db = db;
const store = await import("@/lib/db/scheduledTasks");
const { createScheduledTaskTools, scheduledTasksPrompt, SCHEDULED_TASK_TOOL_ORDER } =
  await import("./tools");

const toolsFor = (userId = "a", timeZone: string | null = "Asia/Kolkata") =>
  createScheduledTaskTools({
    userId,
    timeZone: timeZone ?? undefined,
    modelConfigId: "one",
  });
type Tools = ReturnType<typeof toolsFor>;
const call = async <Name extends keyof Tools>(
  tools: Tools,
  name: Name,
  input: unknown,
): Promise<ScheduledTaskToolOutput> => {
  const tool = tools[name] as unknown as {
    inputSchema: { parse: (value: unknown) => unknown };
    execute: (input: unknown, options: unknown) => ScheduledTaskToolOutput;
  };
  return tool.execute(tool.inputSchema.parse(input), { toolCallId: "call", messages: [] });
};

beforeEach(() => {
  reset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("the scheduled tasks skill", () => {
  it("offers its tools in a fixed order", () => {
    expect(Object.keys(toolsFor())).toEqual([...SCHEDULED_TASK_TOOL_ORDER]);
  });

  it("creates a task on the chat's model, in the user's time zone", async () => {
    const { task } = await call(toolsFor(), "create_scheduled_task", {
      name: " Review pull requests ",
      prompt: "Remind me to review my open pull requests.",
      schedule: { frequency: "weekdays", time: "08:00" },
    });
    expect(task).toMatchObject({
      name: "Review pull requests",
      schedule: "Weekdays at 8:00 AM",
      timeZone: "Asia/Kolkata",
      enabled: true,
      model: "One",
      nextRuns: [
        "2026-11-17T08:00:00+05:30",
        "2026-11-18T08:00:00+05:30",
        "2026-11-19T08:00:00+05:30",
      ],
    });
    expect(store.listScheduledTasks("a")).toMatchObject([
      {
        id: task?.id,
        modelConfigId: "one",
        webSearchEnabled: true,
        schedule: { frequency: "weekdays", hour: 8, minute: 0 },
      },
    ]);
  });

  it("reads every frequency from named fields", async () => {
    const tools = toolsFor();
    const schedules = [
      [{ frequency: "once", time: "18:30", date: "2026-12-01" }, "Once on Dec 1, 2026 at 6:30 PM"],
      [{ frequency: "hourly" }, "Every hour"],
      [{ frequency: "hourly", minute: 20 }, "Every hour at :20"],
      [{ frequency: "daily", time: "00:05" }, "Every day at 12:05 AM"],
      [
        { frequency: "weekly", time: "09:00", days_of_week: ["friday", "monday"] },
        "Every Monday and Friday at 9:00 AM",
      ],
      [{ frequency: "monthly", time: "09:00", day_of_month: 1 }, "Monthly on the 1st at 9:00 AM"],
    ] as const;
    for (const [schedule, words] of schedules) {
      const { task } = await call(tools, "create_scheduled_task", {
        name: "Task",
        prompt: "Do it.",
        schedule,
        web_search: false,
      });
      expect(task?.schedule).toBe(words);
    }
    expect(store.listScheduledTasks("a").every((task) => !task.webSearchEnabled)).toBe(true);
  });

  it("says what a schedule is missing", async () => {
    const tools = toolsFor();
    const create = (schedule: unknown) =>
      call(tools, "create_scheduled_task", { name: "Task", prompt: "Do it.", schedule });
    await expect(create({ frequency: "daily" })).rejects.toThrow(
      "A daily schedule needs a time, as HH:MM.",
    );
    await expect(create({ frequency: "weekly", time: "09:00" })).rejects.toThrow(
      "A weekly schedule needs days_of_week.",
    );
    await expect(create({ frequency: "monthly", time: "09:00" })).rejects.toThrow(
      "A monthly schedule needs day_of_month.",
    );
    await expect(
      create({ frequency: "once", time: "09:00", date: "2026-02-30" }),
    ).rejects.toThrow("A once schedule needs a real date, as YYYY-MM-DD.");
    await expect(
      create({ frequency: "once", time: "09:00", date: "2026-11-01" }),
    ).rejects.toThrow("That time has already passed. Choose a later one.");
    await expect(create({ frequency: "daily", time: "9am" })).rejects.toThrow();
    await expect(create({ frequency: "every 5 minutes" })).rejects.toThrow();
    expect(store.listScheduledTasks("a")).toEqual([]);
  });

  it("uses a time zone the user names, and asks when none is known", async () => {
    const input = {
      name: "Task",
      prompt: "Do it.",
      schedule: { frequency: "daily", time: "09:00" },
    };
    const named = await call(toolsFor(), "create_scheduled_task", {
      ...input,
      time_zone: "Europe/Berlin",
    });
    expect(named.task).toMatchObject({
      timeZone: "Europe/Berlin",
      nextRuns: expect.arrayContaining(["2026-11-17T09:00:00+01:00"]),
    });
    await expect(
      call(toolsFor(), "create_scheduled_task", { ...input, time_zone: "Berlin time" }),
    ).rejects.toThrow('"Berlin time" is not an IANA time zone.');
    await expect(call(toolsFor("a", null), "create_scheduled_task", input)).rejects.toThrow(
      "The user's time zone is not known.",
    );
  });

  it("lists, changes, pauses and deletes only the user's own tasks", async () => {
    const tools = toolsFor();
    const { task } = await call(tools, "create_scheduled_task", {
      name: "Morning news",
      prompt: "Summarize the news.",
      schedule: { frequency: "daily", time: "09:00" },
    });
    const id = task?.id;
    expect((await call(tools, "list_scheduled_tasks", {})).tasks).toMatchObject([
      { id, name: "Morning news" },
    ]);
    const theirs = toolsFor("b");
    expect((await call(theirs, "list_scheduled_tasks", {})).tasks).toEqual([]);
    await expect(
      call(theirs, "update_scheduled_task", { task_id: id, name: "Mine now" }),
    ).rejects.toThrow("Scheduled task not found.");
    await expect(call(theirs, "delete_scheduled_task", { task_id: id })).rejects.toThrow(
      "Scheduled task not found.",
    );

    const moved = await call(tools, "update_scheduled_task", {
      task_id: id,
      schedule: { frequency: "daily", time: "08:30" },
    });
    expect(moved.task).toMatchObject({
      name: "Morning news",
      schedule: "Every day at 8:30 AM",
      nextRuns: expect.arrayContaining(["2026-11-17T08:30:00+05:30"]),
    });
    const paused = await call(tools, "update_scheduled_task", { task_id: id, enabled: false });
    expect(paused.task).toMatchObject({ enabled: false, nextRuns: [] });
    const resumed = await call(tools, "update_scheduled_task", { task_id: id, enabled: true });
    expect(resumed.task?.nextRuns).toHaveLength(3);

    expect(await call(tools, "delete_scheduled_task", { task_id: id })).toMatchObject({
      deleted: true,
      task: { id, name: "Morning news", enabled: false, nextRuns: [] },
    });
    expect(store.listScheduledTasks("a")).toEqual([]);
  });

  it("tells the model the user's time zone, or to ask for it", () => {
    expect(scheduledTasksPrompt("Asia/Kolkata")).toContain(
      "The user's time zone is Asia/Kolkata; use it unless they name another.",
    );
    expect(scheduledTasksPrompt(undefined)).toContain(
      "The user's time zone is not known; ask for it before scheduling.",
    );
  });
});
