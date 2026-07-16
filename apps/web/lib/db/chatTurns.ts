import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";
import { extractSearchText } from "@/lib/search/extract";

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

export type CommitChatTurnResult =
  | "committed"
  | "not-found"
  | "stream-active"
  | "history-conflict";

export async function getChatMessage(
  chatId: string,
  messageId: string,
): Promise<UIMessage | null> {
  const [row] = await db
    .select({ id: messages.id, role: messages.role, parts: messages.parts })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.parts,
  };
}

export function commitChatTurn({
  chatId,
  userId,
  projectId,
  streamId,
  staleStreamId,
  truncateFromMessageId,
  userMessage,
}: {
  chatId: string;
  userId: string;
  projectId: string | null;
  streamId: string;
  staleStreamId: string | null;
  truncateFromMessageId?: string;
  userMessage?: { id: string; parts: AnyPart[] };
}): CommitChatTurnResult {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1)
      .get();

    if (existing && existing.userId !== userId) return "not-found";
    if (existing?.activeStreamId && existing.activeStreamId !== staleStreamId) {
      return "stream-active";
    }

    let truncateFromRowId: number | null = null;
    if (truncateFromMessageId) {
      const target = tx.get<{ rowId: number }>(sql`
        SELECT rowid AS rowId
        FROM ${messages}
        WHERE ${messages.chatId} = ${chatId}
          AND ${messages.id} = ${truncateFromMessageId}
      `);
      if (!target) return "history-conflict";
      truncateFromRowId = target.rowId;
    }

    if (!existing) {
      tx.insert(chats)
        .values({ id: chatId, userId, projectId, title: null })
        .run();
    }

    if (truncateFromRowId !== null) {
      tx.run(sql`
        DELETE FROM ${messages}
        WHERE ${messages.chatId} = ${chatId}
          AND rowid >= ${truncateFromRowId}
      `);
    }

    if (userMessage) {
      tx.insert(messages)
        .values({
          id: userMessage.id,
          chatId,
          role: "user",
          parts: userMessage.parts,
        })
        .run();
      const content = extractSearchText(userMessage.parts);
      if (content) {
        tx.run(sql`
          INSERT INTO messages_fts (content, message_id, chat_id, user_id)
          VALUES (${content}, ${userMessage.id}, ${chatId}, ${userId})
        `);
      }
    }

    tx.update(chats)
      .set({ activeStreamId: streamId, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .run();
    return "committed";
  });
}

export function completeChatStream({
  chatId,
  streamId,
  assistantMessage,
}: {
  chatId: string;
  streamId: string;
  assistantMessage?: { id: string; parts: AnyPart[] };
}): boolean {
  return db.transaction((tx) => {
    const chat = tx
      .select({
        userId: chats.userId,
        activeStreamId: chats.activeStreamId,
      })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1)
      .get();
    if (!chat || chat.activeStreamId !== streamId) return false;

    if (assistantMessage) {
      tx.insert(messages)
        .values({
          id: assistantMessage.id,
          chatId,
          role: "assistant",
          parts: assistantMessage.parts,
        })
        .run();
      const content = extractSearchText(assistantMessage.parts);
      if (content) {
        tx.run(sql`
          INSERT INTO messages_fts (content, message_id, chat_id, user_id)
          VALUES (${content}, ${assistantMessage.id}, ${chatId}, ${chat.userId})
        `);
      }
    }

    tx.update(chats)
      .set({
        activeStreamId: null,
        ...(assistantMessage ? { updatedAt: new Date() } : {}),
      })
      .where(and(eq(chats.id, chatId), eq(chats.activeStreamId, streamId)))
      .run();
    return true;
  });
}

export async function clearActiveStreamId(
  chatId: string,
  streamId: string,
): Promise<void> {
  await db
    .update(chats)
    .set({ activeStreamId: null })
    .where(and(eq(chats.id, chatId), eq(chats.activeStreamId, streamId)));
}
