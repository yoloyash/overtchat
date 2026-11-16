import "server-only";
import type { z } from "zod";
import { ScheduledTaskError } from "@/lib/db/scheduledTasks";
import { inputIssue } from "@/lib/scheduled-tasks/input";

/** A request body as one of the task schemas reads it, or the reply that says what is wrong. */
export async function readTaskBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ data: T } | { response: Response }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      response: Response.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { data: parsed.data }
    : {
        response: Response.json(
          { error: inputIssue(parsed.error) },
          { status: 400 },
        ),
      };
}

/** Turns a refusal the owner can fix into its reply; anything else is thrown on. */
export function taskErrorResponse(error: unknown): Response {
  if (error instanceof ScheduledTaskError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
