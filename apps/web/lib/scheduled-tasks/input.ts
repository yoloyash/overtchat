import { z } from "zod";
import {
  parseTaskSchedule,
  SCHEDULED_TASK_NAME_LIMIT,
  SCHEDULED_TASK_PROMPT_LIMIT,
  type ScheduledTaskInput,
  type ScheduledTaskPatch,
  type TaskSchedule,
} from "@overtchat/shared";
import { isTimeZone } from "@/lib/scheduled-tasks/schedule";

const schedule = z.unknown().transform((value, context): TaskSchedule => {
  const parsed = parseTaskSchedule(value);
  if (!parsed) {
    context.addIssue({
      code: "custom",
      message:
        "Give the schedule a frequency (once, hourly, daily, weekdays, weekly or monthly) and the time fields it needs.",
    });
    return z.NEVER;
  }
  return parsed;
});

const fields = {
  name: z
    .string()
    .trim()
    .min(1, "Give the task a name.")
    .max(SCHEDULED_TASK_NAME_LIMIT, `Keep the name under ${SCHEDULED_TASK_NAME_LIMIT} characters.`),
  prompt: z
    .string()
    .trim()
    .min(1, "Say what the task should do.")
    .max(SCHEDULED_TASK_PROMPT_LIMIT, "The instructions are too long."),
  modelConfigId: z.string().trim().min(1, "Choose a model."),
  schedule,
  timeZone: z
    .string()
    .trim()
    .refine(isTimeZone, "Use an IANA time zone, such as Europe/Berlin."),
  webSearchEnabled: z.boolean(),
  projectId: z.string().trim().min(1).nullable(),
};

export const ScheduledTaskInputSchema = z.object({
  name: fields.name,
  prompt: fields.prompt,
  modelConfigId: fields.modelConfigId,
  schedule: fields.schedule,
  timeZone: fields.timeZone,
  webSearchEnabled: fields.webSearchEnabled.optional(),
  projectId: fields.projectId.optional(),
}) satisfies z.ZodType<ScheduledTaskInput>;

export const ScheduledTaskPatchSchema = z
  .object({
    name: fields.name,
    prompt: fields.prompt,
    modelConfigId: fields.modelConfigId,
    schedule: fields.schedule,
    timeZone: fields.timeZone,
    webSearchEnabled: fields.webSearchEnabled,
    projectId: fields.projectId,
    enabled: z.boolean(),
  })
  .partial() satisfies z.ZodType<ScheduledTaskPatch>;

/** The first problem with a request, in words for the person who made it. */
export function inputIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid scheduled task.";
}
