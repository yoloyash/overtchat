import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  describeTaskSchedule,
  parseTaskSchedule,
  SCHEDULED_TASK_ACTIVE_LIMIT,
  SCHEDULED_TASK_NAME_LIMIT,
  SCHEDULED_TASK_PROMPT_LIMIT,
  type ScheduledTask,
  type ScheduledTaskToolOutput,
  type ScheduledTaskToolTask,
  type TaskSchedule,
} from "@overtchat/shared";
import {
  createScheduledTask,
  deleteScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  scheduledTaskModelLabel,
  scheduledTaskProjectName,
  scheduledTaskProjects,
  updateScheduledTask,
} from "@/lib/db/scheduledTasks";
import {
  formatInTimeZone,
  isTimeZone,
  nextRunsAfter,
} from "@/lib/scheduled-tasks/schedule";

/** The tools in deterministic order. */
export const SCHEDULED_TASK_TOOL_ORDER = [
  "list_scheduled_tasks",
  "create_scheduled_task",
  "update_scheduled_task",
  "delete_scheduled_task",
] as const;

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * A schedule as a model fills it in: flat fields with names, rather than a
 * cron expression it would have to get right.
 */
const scheduleInput = z
  .object({
    frequency: z
      .enum(["once", "hourly", "daily", "weekdays", "weekly", "monthly"])
      .describe(
        "once: one time on a date. hourly: every hour. daily: every day. weekdays: Monday to Friday. weekly: on the given days of the week. monthly: on one day of each month.",
      ),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, such as 09:00.")
      .optional()
      .describe(
        "Time of day as 24-hour HH:MM in the task's time zone. Required for every frequency except hourly.",
      ),
    minute: z
      .number()
      .int()
      .min(0)
      .max(59)
      .optional()
      .describe("hourly only: the minute past each hour. Defaults to 0."),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional()
      .describe("once only: the date, as YYYY-MM-DD."),
    days_of_week: z
      .array(z.enum(DAYS))
      .min(1)
      .optional()
      .describe("weekly only: the days to run on."),
    day_of_month: z
      .number()
      .int()
      .min(1)
      .max(31)
      .optional()
      .describe(
        "monthly only: the day of the month. A month without that day is passed over.",
      ),
  })
  .describe("When the task runs.");

type ScheduleInput = z.infer<typeof scheduleInput>;

function toSchedule(input: ScheduleInput): TaskSchedule {
  if (input.frequency !== "hourly" && !input.time) {
    throw new Error(`A ${input.frequency} schedule needs a time, as HH:MM.`);
  }
  const [hour, minute] = (input.time ?? "00:00").split(":").map(Number);
  const candidate =
    input.frequency === "hourly"
      ? { frequency: "hourly", minute: input.minute ?? 0 }
      : {
          frequency: input.frequency,
          hour,
          minute,
          date: input.date,
          daysOfWeek: input.days_of_week?.map((day) => DAYS.indexOf(day)),
          dayOfMonth: input.day_of_month,
        };
  const schedule = parseTaskSchedule(candidate);
  if (!schedule) {
    throw new Error(
      {
        once: "A once schedule needs a real date, as YYYY-MM-DD.",
        weekly: "A weekly schedule needs days_of_week.",
        monthly: "A monthly schedule needs day_of_month.",
        hourly: "Invalid schedule.",
        daily: "Invalid schedule.",
        weekdays: "Invalid schedule.",
      }[input.frequency],
    );
  }
  return schedule;
}

const timeZoneInput = z
  .string()
  .trim()
  .optional()
  .describe(
    "IANA time zone the schedule's times are in, such as Europe/Berlin. Leave it out to use the user's own time zone.",
  );

const PROJECT_DESCRIPTION =
  "The name of one of the user's projects. Runs then start in that project, with its instructions and files.";

export interface ScheduledTaskToolsOptions {
  userId: string;
  /** The time zone of the device the user is chatting from. */
  timeZone?: string;
  /** The model of this chat, which a new task runs on. */
  modelConfigId: string;
}

/**
 * The tools of the scheduled tasks skill. They act on the tasks of the user
 * in this chat only, with the same checks as the Scheduled page.
 */
export function createScheduledTaskTools({
  userId,
  timeZone: userTimeZone,
  modelConfigId,
}: ScheduledTaskToolsOptions) {
  const describe = (task: ScheduledTask): ScheduledTaskToolTask => {
    const model = scheduledTaskModelLabel(task.modelConfigId);
    const project = scheduledTaskProjectName(task.projectId);
    return {
      id: task.id,
      name: task.name,
      prompt: task.prompt,
      schedule: describeTaskSchedule(task.schedule, "en-US"),
      timeZone: task.timeZone,
      enabled: task.enabled,
      nextRuns: task.enabled
        ? nextRunsAfter(task.schedule, task.timeZone, new Date(), 3).map(
            (date) => formatInTimeZone(date, task.timeZone),
          )
        : [],
      ...(model ? { model } : {}),
      ...(project ? { project } : {}),
    };
  };
  /** The id of the user's project with this name, however it is cased. */
  const projectId = (name: string): string => {
    const wanted = name.trim().toLowerCase();
    const all = scheduledTaskProjects(userId);
    const named = all.filter(
      (project) => project.name.trim().toLowerCase() === wanted,
    );
    if (named.length === 1) return named[0].id;
    if (named.length > 1) {
      throw new Error(
        `More than one project is named "${name}". The user can choose the project on the Scheduled page.`,
      );
    }
    throw new Error(
      all.length > 0
        ? `No project is named "${name}". The user's projects: ${all.map((project) => project.name).join(", ")}.`
        : "The user has no projects.",
    );
  };
  const zone = (given: string | undefined): string => {
    const timeZone = given || userTimeZone;
    if (!timeZone) {
      throw new Error(
        "The user's time zone is not known. Ask which time zone they mean, then pass it as time_zone.",
      );
    }
    if (!isTimeZone(timeZone)) {
      throw new Error(
        `"${timeZone}" is not an IANA time zone. Use a name such as Europe/Berlin.`,
      );
    }
    return timeZone;
  };

  return Object.freeze({
    list_scheduled_tasks: tool({
      description:
        "List the user's scheduled tasks with their ids, schedules and next run times. Use it to find the id of a task to change or delete, or when the user asks what is scheduled.",
      inputSchema: z.object({}),
      execute: (): ScheduledTaskToolOutput => ({
        tasks: listScheduledTasks(userId).map(describe),
      }),
    }),

    create_scheduled_task: tool({
      description: `Schedule a task: a prompt that runs by itself at the times given, each run in a new chat the user is notified about. It runs on this chat's model. Returns the task with its next run times; tell the user the first one. A user may have ${SCHEDULED_TASK_ACTIVE_LIMIT} tasks switched on at once.`,
      inputSchema: z.object({
        name: z
          .string()
          .trim()
          .min(1)
          .max(SCHEDULED_TASK_NAME_LIMIT)
          .describe(
            "A short name, a few words. It titles each run's chat and its notification.",
          ),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(SCHEDULED_TASK_PROMPT_LIMIT)
          .describe(
            "The instructions each run is given, complete and self-contained. A run starts a new chat that has not seen this conversation.",
          ),
        schedule: scheduleInput,
        time_zone: timeZoneInput,
        web_search: z
          .boolean()
          .default(true)
          .describe("Whether runs may search the web."),
        project: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            `${PROJECT_DESCRIPTION} Leave it out for a task outside any project.`,
          ),
      }),
      execute: (input): ScheduledTaskToolOutput => ({
        task: describe(
          createScheduledTask(userId, {
            name: input.name,
            prompt: input.prompt,
            modelConfigId,
            schedule: toSchedule(input.schedule),
            timeZone: zone(input.time_zone),
            webSearchEnabled: input.web_search,
            ...(input.project ? { projectId: projectId(input.project) } : {}),
          }),
        ),
      }),
    }),

    update_scheduled_task: tool({
      description:
        "Change a scheduled task: its name, prompt, schedule, time zone or project, or pause and resume it with enabled. Give only what changes; a schedule is replaced whole. Get the id from list_scheduled_tasks.",
      inputSchema: z.object({
        task_id: z.string().trim().min(1),
        name: z.string().trim().min(1).max(SCHEDULED_TASK_NAME_LIMIT).optional(),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(SCHEDULED_TASK_PROMPT_LIMIT)
          .optional(),
        schedule: scheduleInput.optional(),
        time_zone: timeZoneInput,
        enabled: z
          .boolean()
          .optional()
          .describe("false pauses the task; true resumes it."),
        project: z
          .string()
          .trim()
          .min(1)
          .nullable()
          .optional()
          .describe(
            `${PROJECT_DESCRIPTION} null takes the task out of its project.`,
          ),
      }),
      execute: (input): ScheduledTaskToolOutput => ({
        task: describe(
          updateScheduledTask(input.task_id, userId, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
            ...(input.schedule ? { schedule: toSchedule(input.schedule) } : {}),
            ...(input.time_zone ? { timeZone: zone(input.time_zone) } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            ...(input.project !== undefined
              ? {
                  projectId:
                    input.project === null ? null : projectId(input.project),
                }
              : {}),
          }),
        ),
      }),
    }),

    delete_scheduled_task: tool({
      description:
        "Delete a scheduled task for good. The chats its runs wrote are kept. Use only when the user asks; to stop a task for a while, pause it with update_scheduled_task instead.",
      inputSchema: z.object({ task_id: z.string().trim().min(1) }),
      execute: ({ task_id }): ScheduledTaskToolOutput => {
        const task = getScheduledTask(task_id, userId);
        if (!task || !deleteScheduledTask(task_id, userId)) {
          throw new Error("Scheduled task not found.");
        }
        return { task: { ...describe(task), enabled: false, nextRuns: [] }, deleted: true };
      },
    }),
  });
}

export const SCHEDULED_TASKS_SKILL_DESCRIPTION =
  "Schedule a prompt to run by itself, once or on a repeating schedule, and list, change, pause or delete the user's scheduled tasks. Load it when the user asks for a reminder, a recurring briefing or check, or anything to be done later or regularly.";

/** The instructions a view of the skill loads. */
export function scheduledTasksPrompt(
  timeZone: string | undefined,
  /** The project this chat is in, if it is in one. */
  project?: string,
): string {
  return `Scheduled tasks:
A scheduled task is a prompt this app runs for the user by itself, once or on a repeating schedule. Each run starts a new chat with the task's prompt and the app notifies the user when it finishes. The Scheduled page lists the tasks and their runs.
Setting one up: you need what to do, when, and how often. Ask for whatever the user has not said, one short question at a time, and do not guess a time of day. When the request is already complete, schedule it without asking again.
The prompt is all a run knows. It has not seen this conversation, so write the prompt as complete instructions: name the topics, places, sources, people and the form of the answer the user wants, rather than "the above" or "as discussed". For a reminder, write a prompt that tells the user what to remember.
Runs happen with nobody present. They can search the web, run code and read the user's connected accounts, but they cannot ask the user anything, and an email a run writes waits for the user to send it.
Times are wall-clock times in the task's time zone. ${timeZone ? `The user's time zone is ${timeZone}; use it unless they name another.` : "The user's time zone is not known; ask for it before scheduling."} Work out a date such as "tomorrow" from the current date you were given.
A task can run in one of the user's projects, with that project's instructions and files: pass the project's name. ${project ? `This chat is in the project "${project}"; put a task there when it is about that project's material, and say that you did.` : "Otherwise it runs outside any project."}
A task cannot run more often than hourly. If the user wants that, say so and offer hourly.
After creating or changing a task, tell the user its name, its schedule in plain words and when it first runs next, taken from the result. Change or delete a task only when the user asks, and find its id with list_scheduled_tasks first.`;
}
