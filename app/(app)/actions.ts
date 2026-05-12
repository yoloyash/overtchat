"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/server";
import { deleteChat, renameChat } from "@/lib/db/chats";
import {
  createProject,
  deleteProject,
  moveChatToProject,
  updateProject,
} from "@/lib/db/projects";

async function requireUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  return session.user.id;
}

export async function deleteChatAction(id: string) {
  const userId = await requireUserId();
  await deleteChat(id, userId);
  revalidatePath("/");
}

export async function renameChatAction(id: string, title: string) {
  const userId = await requireUserId();
  await renameChat(id, userId, title);
  revalidatePath("/");
}

export async function createProjectAction(
  name: string,
  instructions?: string | null,
): Promise<{ id: string }> {
  const userId = await requireUserId();
  const row = await createProject(userId, { name, instructions });
  revalidatePath("/");
  return { id: row.id };
}

export async function updateProjectAction(
  id: string,
  patch: { name?: string; instructions?: string | null },
) {
  const userId = await requireUserId();
  await updateProject(id, userId, patch);
  revalidatePath("/");
  revalidatePath(`/projects/${id}`);
}

export async function deleteProjectAction(id: string) {
  const userId = await requireUserId();
  await deleteProject(id, userId);
  revalidatePath("/");
}

export async function moveChatToProjectAction(
  chatId: string,
  projectId: string | null,
) {
  const userId = await requireUserId();
  await moveChatToProject(chatId, userId, projectId);
  revalidatePath("/");
}
