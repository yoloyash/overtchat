import {
  SCHEDULED_TASK_ACTIVE_LIMIT,
  type ScheduledTaskListResponse,
} from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { createScheduledTask, listScheduledTasks } from "@/lib/db/scheduledTasks";
import { readTaskBody, taskErrorResponse } from "@/lib/scheduled-tasks/http";
import { ScheduledTaskInputSchema } from "@/lib/scheduled-tasks/input";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body: ScheduledTaskListResponse = {
    tasks: listScheduledTasks(session.user.id),
    activeLimit: SCHEDULED_TASK_ACTIVE_LIMIT,
  };
  return Response.json(body);
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const input = await readTaskBody(req, ScheduledTaskInputSchema);
  if ("response" in input) return input.response;
  try {
    const task = createScheduledTask(session.user.id, input.data);
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return taskErrorResponse(error);
  }
}
