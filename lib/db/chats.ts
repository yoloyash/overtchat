import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

export type ChatRow = typeof chats.$inferSelect;

export async function getChat(
  id: string,
  userId: string,
): Promise<ChatRow | null> {
  const [row] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Idempotent: if the chat exists and belongs to `userId`, returns it. If no
 * chat with this id exists, creates it. If a chat with this id exists but
 * belongs to someone else, returns null.
 */
export async function ensureChat(
  id: string,
  userId: string,
): Promise<ChatRow | null> {
  const [existing] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, id))
    .limit(1);
  if (existing) return existing.userId === userId ? existing : null;
  const [row] = await db
    .insert(chats)
    .values({ id, userId, title: null })
    .returning();
  return row;
}

export async function listChats(
  userId: string,
  limit = 100,
): Promise<ChatRow[]> {
  return db
    .select()
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt))
    .limit(limit);
}

export async function deleteChat(id: string, userId: string): Promise<void> {
  await db
    .delete(chats)
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function renameChat(
  id: string,
  userId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim().slice(0, 200);
  if (!trimmed) return;
  await db
    .update(chats)
    .set({ title: trimmed, updatedAt: new Date() })
    .where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function touchChat(id: string): Promise<void> {
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, id));
}

export async function appendMessage(
  chatId: string,
  role: "user" | "assistant" | "system",
  parts: AnyPart[],
): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await db.insert(messages).values({ id, chatId, role, parts });
  return { id };
}

export async function getMessages(chatId: string): Promise<UIMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage["role"],
    parts: r.parts as UIMessage["parts"],
  }));
}

export async function setTitleIfNull(
  id: string,
  title: string,
): Promise<void> {
  await db
    .update(chats)
    .set({ title })
    .where(and(eq(chats.id, id), sql`${chats.title} IS NULL`));
}
