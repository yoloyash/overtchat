import { auth } from "@/lib/auth/server";
import {
  createProject,
  listProjects,
  toProjectListItem,
} from "@/lib/db/projects";

type PostBody = { name?: string; instructions?: string | null };

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rows = await listProjects(session.user.id);
  return Response.json({ projects: rows.map(toProjectListItem) });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const body = (await req.json()) as PostBody;
  if (!body.name?.trim()) {
    return Response.json({ error: "name required" }, { status: 400 });
  }
  const row = await createProject(session.user.id, {
    name: body.name,
    instructions: body.instructions ?? null,
  });
  return Response.json({ project: toProjectListItem(row) }, { status: 201 });
}
