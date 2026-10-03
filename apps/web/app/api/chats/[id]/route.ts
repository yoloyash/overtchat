import { auth } from "@/lib/auth/server";
import { deleteChat, updateChatMetadata } from "@/lib/db/chats";
import { z } from "zod";
import { closeChatMcpRuntime } from "@/lib/mcp/manager";

const patchSchema = z.object({
  title: z.string().optional(),
  projectId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const body = parsed.data;

  const ok = await updateChatMetadata(id, session.user.id, body);
  if (!ok) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 204 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  await deleteChat(id, session.user.id);
  await closeChatMcpRuntime({ chatId: id, userId: session.user.id });
  return new Response(null, { status: 204 });
}
