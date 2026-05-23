import { auth } from "@/lib/auth/server";
import {
  deleteProject,
  getProject,
  updateProject,
} from "@/lib/db/projects";

type PatchBody = {
  name?: string;
  instructions?: string | null;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const row = await getProject(id, session.user.id);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({
    project: {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      updatedAt: row.updatedAt.getTime(),
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as PatchBody;
  const row = await updateProject(id, session.user.id, body);
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({
    project: {
      id: row.id,
      name: row.name,
      instructions: row.instructions,
      updatedAt: row.updatedAt.getTime(),
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  await deleteProject(id, session.user.id);
  return new Response(null, { status: 204 });
}
