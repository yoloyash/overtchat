import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";

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

export async function listChatsByProject(
  projectId: string,
  userId: string,
): Promise<ChatRow[]> {
  return db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), eq(chats.projectId, projectId)))
    .orderBy(desc(chats.updatedAt));
}

export async function deleteChat(id: string, userId: string): Promise<void> {
  await db.delete(chats).where(and(eq(chats.id, id), eq(chats.userId, userId)));
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

export async function getActiveStreamId(
  chatId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ activeStreamId: chats.activeStreamId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  return row?.activeStreamId ?? null;
}

export async function getMessages(chatId: string): Promise<UIMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(sql`${messages}.rowid`);
  return rows.map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.parts as UIMessage["parts"],
  }));
}

export async function setTitleIfNull(
  id: string,
  title: string,
): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const [row] = await db
    .update(chats)
    .set({ title: trimmed })
    .where(and(eq(chats.id, id), sql`${chats.title} IS NULL`))
    .returning({ title: chats.title });
  return row?.title ?? null;
}
