import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db/client";
import { chatGenerations, chats, messages } from "@/lib/db/schema";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  type ChatMessagePage,
} from "@/lib/chat/history";

export type ChatRow = typeof chats.$inferSelect;

type MessageRow = typeof messages.$inferSelect;
type MessageUIRow = Pick<MessageRow, "id" | "role" | "parts" | "metadata">;
type RawMessagePageRow = {
  id: string;
  role: MessageRow["role"];
  parts: string | MessageRow["parts"];
  metadata: string | MessageRow["metadata"];
  rowId: number;
};

function toUIMessage(row: MessageUIRow): UIMessage {
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.parts as UIMessage["parts"],
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

function parseJsonColumn<T>(value: string | T): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function decodeMessageCursor(cursor: string): number {
  const rowId = Number(cursor);
  if (!Number.isSafeInteger(rowId) || rowId <= 0) {
    throw new Error("Invalid message cursor");
  }
  return rowId;
}

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

export async function getChatTitleContext(
  id: string,
  userId: string,
): Promise<{
  title: string | null;
  firstUserParts: UIMessage["parts"] | null;
} | null> {
  const [row] = await db
    .select({
      title: chats.title,
      firstUserParts: messages.parts,
    })
    .from(chats)
    .leftJoin(
      messages,
      and(eq(messages.chatId, chats.id), eq(messages.role, "user")),
    )
    .where(and(eq(chats.id, id), eq(chats.userId, userId)))
    .orderBy(sql`${messages}.rowid`)
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

export async function listActiveChatIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: chats.id })
    .from(chats)
    .innerJoin(chatGenerations, eq(chats.activeStreamId, chatGenerations.id))
    .where(
      and(
        eq(chats.userId, userId),
        eq(chatGenerations.userId, userId),
        eq(chatGenerations.status, "running"),
      ),
    );
  return rows.map(({ id }) => id);
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
  return rows.map(toUIMessage);
}

export async function getLatestMessageRowId(
  chatId: string,
): Promise<number | null> {
  const row = await db.get<{ rowId: number }>(sql`
    SELECT rowid AS rowId
    FROM ${messages}
    WHERE ${messages.chatId} = ${chatId}
    ORDER BY rowid DESC
    LIMIT 1
  `);
  return row?.rowId ?? null;
}

export async function getMessagesThroughRowId(
  chatId: string,
  throughRowId: number | null,
): Promise<UIMessage[]> {
  if (throughRowId === null) return [];
  const rows = await db.all<RawMessagePageRow>(sql`
    SELECT
      ${messages.id} AS id,
      ${messages.role} AS role,
      ${messages.parts} AS parts,
      ${messages.metadata} AS metadata,
      ${messages}.rowid AS rowId
    FROM ${messages}
    WHERE ${messages.chatId} = ${chatId}
      AND ${messages}.rowid <= ${throughRowId}
    ORDER BY ${messages}.rowid
  `);
  return rows.map((row) =>
    toUIMessage({
      ...row,
      parts: parseJsonColumn<MessageRow["parts"]>(row.parts),
      metadata:
        row.metadata === null
          ? null
          : parseJsonColumn<NonNullable<MessageRow["metadata"]>>(
              row.metadata,
            ),
    }),
  );
}

/**
 * Loads a newest-first keyset page and returns it in transcript order.
 * SQLite rowids are the existing canonical ordering for messages, so the
 * cursor preserves edit/regenerate and import ordering without a migration.
 */
export async function getMessagesPage(
  chatId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ChatMessagePage> {
  const limit = Math.min(
    100,
    Math.max(1, Math.trunc(options.limit ?? CHAT_MESSAGE_PAGE_SIZE)),
  );
  const beforeRowId = options.cursor
    ? decodeMessageCursor(options.cursor)
    : Number.MAX_SAFE_INTEGER;
  const rows = await db.all<RawMessagePageRow>(sql`
    SELECT
      ${messages.id} AS id,
      ${messages.role} AS role,
      ${messages.parts} AS parts,
      ${messages.metadata} AS metadata,
      ${messages}.rowid AS rowId
    FROM ${messages}
    WHERE ${messages.chatId} = ${chatId}
      AND ${messages}.rowid < ${beforeRowId}
    ORDER BY ${messages}.rowid DESC
    LIMIT ${limit + 1}
  `);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const oldest = pageRows.at(-1);
  return {
    messages: pageRows.reverse().map((row) =>
      toUIMessage({
        ...row,
        parts: parseJsonColumn<MessageRow["parts"]>(row.parts),
        metadata:
          row.metadata === null
            ? null
            : parseJsonColumn<NonNullable<MessageRow["metadata"]>>(
                row.metadata,
              ),
      }),
    ),
    nextCursor: hasMore && oldest ? String(oldest.rowId) : null,
  };
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
