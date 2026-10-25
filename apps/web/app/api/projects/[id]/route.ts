import { auth } from "@/lib/auth/server";
import {
  deleteProject,
  getProject,
  toProjectListItem,
  updateProject,
} from "@/lib/db/projects";

type PatchBody = {
  name?: string;
  instructions?: string | null;
  defaultModelId?: string | null;
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
  return Response.json({ project: toProjectListItem(row) });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as PatchBody;
  if (
    body.defaultModelId !== undefined &&
    body.defaultModelId !== null &&
    typeof body.defaultModelId !== "string"
  ) {
    return Response.json({ error: "Invalid default model" }, { status: 400 });
  }
  const row = await updateProject(id, session.user.id, body);
  if (row === "model-unavailable") {
    return Response.json(
      { error: "That model is no longer available" },
      { status: 400 },
    );
  }
  if (!row) return new Response("Not found", { status: 404 });
  return Response.json({ project: toProjectListItem(row) });
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
