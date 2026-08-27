import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { UIMessage, UIMessagePart, UIDataTypes, UITools } from "ai";
import { db } from "@/lib/db/client";
import { tryRecordGenerationUsage } from "@/lib/db/generationUsage";
import { chats, messages } from "@/lib/db/schema";
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
  | "not-found"
  | "stream-active"
  | "history-conflict";

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
  staleStreamId,
  truncateFromMessageId,
  userMessage,
  assistantContinuation,
}: {
  chatId: string;
  userId: string;
  projectId: string | null;
  streamId: string;
  staleStreamId: string | null;
  truncateFromMessageId?: string;
  userMessage?: { id: string; parts: AnyPart[] };
  assistantContinuation?: { id: string; parts: AnyPart[] };
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
    if (assistantContinuation) {
      const latest = tx.get<{ id: string; role: string; parts: string }>(sql`
        SELECT id, role, parts
        FROM ${messages}
        WHERE ${messages.chatId} = ${chatId}
        ORDER BY rowid DESC
        LIMIT 1
      `);
      const storedParts = latest ? parseParts(latest.parts) : null;
      if (
        !existing ||
        latest?.id !== assistantContinuation.id ||
        latest.role !== "assistant" ||
        !storedParts ||
        !isValidCodeContinuation(storedParts, assistantContinuation.parts)
      ) {
        return "history-conflict";
      }
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
    if (assistantContinuation) {
      tx.update(messages)
        .set({ parts: assistantContinuation.parts })
        .where(
          and(
            eq(messages.id, assistantContinuation.id),
            eq(messages.chatId, chatId),
          ),
        )
        .run();
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
}: {
  chatId: string;
  streamId: string;
  assistantMessage?: {
    id: string;
    parts: AnyPart[];
    metadata?: Record<string, unknown>;
  };
  usage?: CompletedGenerationUsage;
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
      const existingAssistant = tx
        .select({ chatId: messages.chatId, role: messages.role })
        .from(messages)
        .where(eq(messages.id, assistantMessage.id))
        .limit(1)
        .get();
      if (existingAssistant) {
        if (
          existingAssistant.chatId !== chatId ||
          existingAssistant.role !== "assistant"
        ) {
          return null;
        }
        tx.update(messages)
          .set({
            parts: assistantMessage.parts,
            metadata: assistantMessage.metadata,
          })
          .where(
            and(eq(messages.id, assistantMessage.id), eq(messages.chatId, chatId)),
          )
          .run();
        tx.run(sql`
          DELETE FROM messages_fts
          WHERE message_id = ${assistantMessage.id}
            AND chat_id = ${chatId}
        `);
      } else {
        tx.insert(messages)
          .values({
            id: assistantMessage.id,
            chatId,
            role: "assistant",
            parts: assistantMessage.parts,
            metadata: assistantMessage.metadata,
          })
          .run();
      }
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

function parseParts(value: string): AnyPart[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AnyPart[]) : null;
  } catch {
    return null;
  }
}

function isValidCodeContinuation(
  stored: readonly AnyPart[],
  submitted: readonly AnyPart[],
): boolean {
  if (stored.length !== submitted.length) return false;
  let completedCodeCall = false;

  for (let index = 0; index < stored.length; index += 1) {
    const before = stored[index] as Record<string, unknown>;
    const after = submitted[index] as Record<string, unknown>;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (
      before.type !== "tool-execute_code" ||
      after.type !== "tool-execute_code" ||
      before.toolCallId !== after.toolCallId ||
      (before.state !== "input-available" && before.state !== "input-streaming") ||
      (after.state !== "output-available" && after.state !== "output-error")
    ) {
      return false;
    }
    const beforeCall = codeCallIdentity(before);
    const afterCall = codeCallIdentity(after);
    if (JSON.stringify(beforeCall) !== JSON.stringify(afterCall)) return false;
    completedCodeCall = true;
  }

  return completedCodeCall;
}

function codeCallIdentity(
  part: Record<string, unknown>,
): Record<string, unknown> {
  const identity = { ...part };
  delete identity.state;
  delete identity.output;
  delete identity.errorText;
  return identity;
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
