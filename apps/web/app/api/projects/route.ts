import { auth } from "@/lib/auth/server";
import { createProject, listProjects } from "@/lib/db/projects";
import type { ProjectListItem } from "@/lib/queries/projects";

type PostBody = { name?: string; instructions?: string | null };

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const rows = await listProjects(session.user.id);
  const items: ProjectListItem[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    instructions: p.instructions,
    updatedAt: p.updatedAt.getTime(),
  }));
  return Response.json({ projects: items });
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
  return Response.json(
    {
      project: {
        id: row.id,
        name: row.name,
        instructions: row.instructions,
        updatedAt: row.updatedAt.getTime(),
      },
    },
    { status: 201 },
  );
}
