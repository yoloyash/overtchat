import { auth } from "@/lib/auth/server";
import { generateAndPersistTitle } from "@/lib/title";

export const maxDuration = 60;

type Body = {
  modelConfigId?: string;
  userText?: string;
  projectId?: string | null;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const { modelConfigId, userText, projectId } = (await req
    .json()
    .catch(() => ({}))) as Body;
  if (!modelConfigId) {
    return new Response("Missing modelConfigId", { status: 400 });
  }
  if (typeof userText !== "string" || !userText.trim()) {
    return new Response("Missing userText", { status: 400 });
  }

  const title = await generateAndPersistTitle({
    chatId: id,
    userId: session.user.id,
    modelConfigId,
    userText,
    projectId: projectId ?? null,
  });
  if (title === null) return new Response("Not found", { status: 404 });
  return Response.json({ title });
}
