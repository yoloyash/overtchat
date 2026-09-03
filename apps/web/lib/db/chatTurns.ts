import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import type { ChatGenerationStatus } from "@overtchat/shared";
import { db } from "@/lib/db/client";
import { tryRecordGenerationUsage } from "@/lib/db/generationUsage";
import { chatGenerations, chats, messages } from "@/lib/db/schema";
import type { ProviderId } from "@/lib/providers/catalog";
import type { EstimatedGenerationCost } from "@/lib/providers/server/model-cost";
import { extractSearchText } from "@/lib/search/extract";

type AnyPart = UIMessagePart<UIDataTypes, UITools>;

export type CompletedGenerationUsage = {
  occurredAt: Date;
  providerId: ProviderId;
  model: string;
  inputTokens?: number;
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  finishReason?: string;
} & Partial<EstimatedGenerationCost>;

export type CommitChatTurnResult =
  | "committed"
  | "duplicate"
  | "idempotency-conflict"
  | "not-found"
  | "stream-active"
  | "history-conflict";

export type ChatGenerationRow = typeof chatGenerations.$inferSelect;

export async function getChatGeneration(
  streamId: string,
  userId: string,
): Promise<ChatGenerationRow | null> {
  const [row] = await db
    .select()
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.id, streamId),
        eq(chatGenerations.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getChatGenerationByRequestId(
  userId: string,
  clientRequestId: string,
): Promise<ChatGenerationRow | null> {
  const [row] = await db
    .select()
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.userId, userId),
        eq(chatGenerations.clientRequestId, clientRequestId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getLatestChatGeneration(
  chatId: string,
  userId: string,
): Promise<ChatGenerationRow | null> {
  const [row] = await db
    .select()
    .from(chatGenerations)
    .where(
      and(
        eq(chatGenerations.chatId, chatId),
        eq(chatGenerations.userId, userId),
      ),
    )
    .orderBy(sql`${chatGenerations.startedAt} DESC`)
    .limit(1);
  return row ?? null;
}

export async function getChatMessage(
  chatId: string,
  messageId: string,
): Promise<UIMessage | null> {
  const [row] = await db
    .select({
      id: messages.id,
      role: messages.role,
      parts: messages.parts,
      metadata: messages.metadata,
    })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), eq(messages.id, messageId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: row.parts,
    ...(row.metadata ? { metadata: row.metadata } : {}),
  };
}

export function commitChatTurn({
  chatId,
  userId,
  projectId,
  streamId,
  clientRequestId,
  requestFingerprint,
  staleStreamId,
  truncateFromMessageId,
  userMessage,
}: {
  chatId: string;
  userId: string;
  projectId: string | null;
  streamId: string;
  clientRequestId: string;
  requestFingerprint: string;
  staleStreamId: string | null;
  truncateFromMessageId?: string;
  userMessage?: { id: string; parts: AnyPart[] };
}): CommitChatTurnResult {
  return db.transaction((tx) => {
    const duplicate = tx
      .select({
        chatId: chatGenerations.chatId,
        requestFingerprint: chatGenerations.requestFingerprint,
      })
      .from(chatGenerations)
      .where(
        and(
          eq(chatGenerations.userId, userId),
          eq(chatGenerations.clientRequestId, clientRequestId),
        ),
      )
      .limit(1)
      .get();
    if (duplicate) {
      return duplicate.chatId === chatId &&
        duplicate.requestFingerprint === requestFingerprint
        ? "duplicate"
        : "idempotency-conflict";
    }

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

    if (staleStreamId) {
      tx.update(chatGenerations)
        .set({
          status: "error",
          error: "Generation stream was no longer available.",
          completedAt: new Date(),
        })
        .where(
          and(
            eq(chatGenerations.id, staleStreamId),
            eq(chatGenerations.status, "running"),
          ),
        )
        .run();
    }

    tx.insert(chatGenerations)
      .values({
        id: streamId,
        chatId,
        userId,
        clientRequestId,
        requestFingerprint,
        status: "running",
      })
      .run();

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
  usage,
  status = assistantMessage ? "complete" : "error",
  error,
}: {
  chatId: string;
  streamId: string;
  assistantMessage?: {
    id: string;
    parts: AnyPart[];
    metadata?: Record<string, unknown>;
  };
  usage?: CompletedGenerationUsage;
  status?: Exclude<ChatGenerationStatus, "running">;
  error?: string;
}): boolean {
  const completed = db.transaction((tx) => {
    const chat = tx
      .select({
        userId: chats.userId,
        activeStreamId: chats.activeStreamId,
      })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1)
      .get();
    if (!chat || chat.activeStreamId !== streamId) return null;

    if (assistantMessage) {
      tx.insert(messages)
        .values({
          id: assistantMessage.id,
          chatId,
          role: "assistant",
          parts: assistantMessage.parts,
          metadata: assistantMessage.metadata,
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
    tx.update(chatGenerations)
      .set({
        status,
        error: error ?? null,
        responseMessageId: assistantMessage?.id ?? null,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(chatGenerations.id, streamId),
          eq(chatGenerations.status, "running"),
        ),
      )
      .run();
    return { userId: chat.userId };
  });

  if (!completed) return false;

  if (assistantMessage && usage) {
    tryRecordGenerationUsage({
      id: streamId,
      userId: completed.userId,
      chatId,
      messageId: assistantMessage.id,
      context: "chat",
      ...usage,
    });
  }

  return true;
}

export function failChatStream({
  chatId,
  streamId,
  error,
}: {
  chatId: string;
  streamId: string;
  error: string;
}): boolean {
  return completeChatStream({
    chatId,
    streamId,
    status: "error",
    error,
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
