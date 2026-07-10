import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import { extractSearchText } from "@/lib/search/extract";

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
 *
 * `projectId` is only used on the insert path. If the chat already exists, the
 * stored row is returned as-is — moving a chat between projects is an explicit
 * operation (see `moveChatToProject`).
 */
export async function ensureChat(
  id: string,
  userId: string,
  projectId: string | null = null,
): Promise<ChatRow | null> {
  const [existing] = await db
    .select()
    .from(chats)
    .where(eq(chats.id, id))
    .limit(1);
  if (existing) return existing.userId === userId ? existing : null;
  const [row] = await db
    .insert(chats)
    .values({ id, userId, projectId, title: null })
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

export async function setActiveStreamId(
  chatId: string,
  streamId: string | null,
): Promise<void> {
  await db
    .update(chats)
    .set({ activeStreamId: streamId })
    .where(eq(chats.id, chatId));
}

export async function appendMessage(
  chatId: string,
  role: "user" | "assistant" | "system",
  parts: AnyPart[],
  id: string = crypto.randomUUID(),
): Promise<{ id: string }> {
  await db.insert(messages).values({ id, chatId, role, parts });
  const content = extractSearchText(parts);
  if (content) {
    await db.run(sql`
      INSERT INTO messages_fts (content, message_id, chat_id, user_id)
      SELECT ${content}, ${id}, ${chatId}, ${chats.userId}
      FROM ${chats} WHERE ${chats.id} = ${chatId}
    `);
  }
  return { id };
}

/**
 * Deletes the message with `fromId` and every later message in the same chat.
 * Used by edit (delete the edited user msg + everything after, then re-insert)
 * and regenerate (delete the assistant msg + anything after it).
 */
export async function deleteMessagesFrom(
  chatId: string,
  fromId: string,
): Promise<void> {
  const [row] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.id, fromId)))
    .limit(1);
  if (!row) return;
  await db
    .delete(messages)
    .where(
      and(eq(messages.chatId, chatId), gte(messages.createdAt, row.createdAt)),
    );
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
