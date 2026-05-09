"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/server";
import { deleteChat, renameChat } from "@/lib/db/chats";

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
