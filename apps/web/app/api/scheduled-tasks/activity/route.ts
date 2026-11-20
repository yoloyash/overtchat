import type { ScheduledTaskActivityResponse } from "@overtchat/shared";
import { auth } from "@/lib/auth/server";
import { listScheduledTaskActivity } from "@/lib/db/scheduledTasks";

/** Runs in progress, and finished runs whose chat has not been opened. */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body: ScheduledTaskActivityResponse = {
    runs: listScheduledTaskActivity(session.user.id),
  };
  const response = Response.json(body);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
