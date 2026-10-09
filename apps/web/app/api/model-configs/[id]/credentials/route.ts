import { auth } from "@/lib/auth/server";
import {
  getModelConfig,
  listModelUserCredentials,
} from "@/lib/db/modelConfigs";

/** Which users have a credential for a per-user model. Keys are never returned. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  const { id } = await params;
  if (!(await getModelConfig(id))) return new Response("Not found", { status: 404 });
  return Response.json({ credentials: listModelUserCredentials(id) });
}
