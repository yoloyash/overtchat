import { auth } from "@/lib/auth/server";
import {
  getScheduledTaskRow,
  listScheduledTaskRuns,
} from "@/lib/db/scheduledTasks";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!getScheduledTaskRow(id, session.user.id)) {
    return new Response("Not found", { status: 404 });
  }
  const response = Response.json({
    runs: listScheduledTaskRuns(id, session.user.id),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
