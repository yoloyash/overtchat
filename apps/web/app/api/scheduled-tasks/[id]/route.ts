import { auth } from "@/lib/auth/server";
import {
  deleteScheduledTask,
  getScheduledTask,
  updateScheduledTask,
} from "@/lib/db/scheduledTasks";
import { readTaskBody, taskErrorResponse } from "@/lib/scheduled-tasks/http";
import { ScheduledTaskPatchSchema } from "@/lib/scheduled-tasks/input";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const task = getScheduledTask((await params).id, session.user.id);
  if (!task) return new Response("Not found", { status: 404 });
  return Response.json({ task });
}

export async function PATCH(req: Request, { params }: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const patch = await readTaskBody(req, ScheduledTaskPatchSchema);
  if ("response" in patch) return patch.response;
  try {
    const task = updateScheduledTask(
      (await params).id,
      session.user.id,
      patch.data,
    );
    return Response.json({ task });
  } catch (error) {
    return taskErrorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: Context) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  if (!deleteScheduledTask((await params).id, session.user.id)) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(null, { status: 204 });
}
