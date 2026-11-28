import { auth } from "@/lib/auth/server";
import { getScheduledTaskRun } from "@/lib/db/scheduledTasks";
import { taskErrorResponse } from "@/lib/scheduled-tasks/http";
import { runScheduledTaskNow } from "@/lib/scheduled-tasks/scheduler";

/** Runs the task once now, beside its schedule. The run goes on after the reply. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  try {
    const claim = runScheduledTaskNow((await params).id, session.user.id);
    return Response.json(
      { run: getScheduledTaskRun(claim.runId, session.user.id) },
      { status: 202 },
    );
  } catch (error) {
    return taskErrorResponse(error);
  }
}
