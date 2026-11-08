import { auth } from "@/lib/auth/server";
import { addProjectFile, listProjectFiles } from "@/lib/db/project-files";
import { getProject } from "@/lib/db/projects";
import { MAX_PROJECT_FILES } from "@/lib/project-files";

type PostBody = { uploadId?: unknown; sourceChatId?: unknown };

const ID = /^[a-zA-Z0-9_-]{1,200}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  if (!(await getProject(id, session.user.id))) {
    return new Response("Not found", { status: 404 });
  }
  return Response.json(
    { files: await listProjectFiles(id, session.user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Links an existing upload (see `POST /api/uploads`) to the project. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as PostBody | null;
  const uploadId = body?.uploadId;
  if (typeof uploadId !== "string" || !ID.test(uploadId)) {
    return Response.json({ error: "Invalid upload" }, { status: 400 });
  }
  const sourceChatId = body?.sourceChatId;
  if (
    sourceChatId !== undefined &&
    sourceChatId !== null &&
    (typeof sourceChatId !== "string" || !ID.test(sourceChatId))
  ) {
    return Response.json({ error: "Invalid source chat" }, { status: 400 });
  }

  const result = await addProjectFile({
    projectId: id,
    userId: session.user.id,
    uploadId,
    sourceChatId: sourceChatId ?? null,
  });
  if (!result.ok) {
    switch (result.reason) {
      case "project-not-found":
        return new Response("Not found", { status: 404 });
      case "upload-not-found":
        return Response.json({ error: "That file is not available." }, { status: 400 });
      case "image":
        return Response.json(
          { error: "Project files are documents and text. Attach images to a message instead." },
          { status: 400 },
        );
      case "limit":
        return Response.json(
          { error: `A project holds up to ${MAX_PROJECT_FILES} files.` },
          { status: 400 },
        );
    }
  }
  return Response.json({ file: result.file }, { status: result.created ? 201 : 200 });
}
