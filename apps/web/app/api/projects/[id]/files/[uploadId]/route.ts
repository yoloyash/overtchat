import { auth } from "@/lib/auth/server";
import { removeProjectFile } from "@/lib/db/project-files";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; uploadId: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id, uploadId } = await params;
  const removed = await removeProjectFile(id, session.user.id, uploadId);
  if (!removed) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 204 });
}
