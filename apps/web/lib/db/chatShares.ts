import "server-only";
import {
  collectOpenUIStates,
  type SharedConversationPage,
} from "@overtchat/shared";
import type { UIMessage } from "ai";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  chats,
  messages,
  chatShares,
  chatShareUploads,
  uploads,
} from "./schema";
import { sharedMessages } from "@/lib/sharing";
import { mapUploadReferences } from "@/lib/sharing-uploads";

export class ShareConflict extends Error {}
export class ShareBadRequest extends Error {}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function snapshot(tx: Transaction, chatId: string, userId: string) {
  const chat = tx
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .get();
  if (!chat) return null;
  if (chat.activeStreamId)
    throw new ShareConflict("Wait for the response to finish before sharing.");
  const rows = tx
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt), asc(sql`rowid`))
    .all();
  const content = sharedMessages(
    rows.map(({ id, role, parts, metadata }) => ({
      id,
      role,
      parts,
      metadata,
    })),
  );
  if (!content.length)
    throw new ShareConflict("Send a message before sharing this chat.");
  const fileIds = new Set<string>();
  mapUploadReferences(content, (id) => {
    fileIds.add(id);
    return `/api/uploads/${id}`;
  });
  for (const id of fileIds) {
    if (
      !tx
        .select({ id: uploads.id })
        .from(uploads)
        .where(and(eq(uploads.id, id), eq(uploads.userId, userId)))
        .get()
    ) {
      throw new ShareConflict(
        "An attachment is unavailable. Remove it from the chat before sharing.",
      );
    }
  }
  return { title: chat.title || "Untitled", messages: content, fileIds };
}

export function previewChatShare(chatId: string, userId: string) {
  return db.transaction((tx) => {
    const content = snapshot(tx, chatId, userId);
    return content
      ? { title: content.title, messages: content.messages }
      : null;
  });
}

const summaryColumns = {
  id: chatShares.id,
  chatId: chatShares.chatId,
  title: chatShares.title,
  createdAt: chatShares.createdAt,
  updatedAt: chatShares.updatedAt,
};

function summary(
  row: Pick<typeof chatShares.$inferSelect, keyof typeof summaryColumns>,
) {
  return {
    id: row.id,
    chatId: row.chatId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function listChatShares(userId: string) {
  return db
    .select(summaryColumns)
    .from(chatShares)
    .where(eq(chatShares.userId, userId))
    .orderBy(desc(chatShares.updatedAt))
    .all()
    .map(summary);
}

export function getChatShare(chatId: string, userId: string) {
  const row = db
    .select(summaryColumns)
    .from(chatShares)
    .where(and(eq(chatShares.chatId, chatId), eq(chatShares.userId, userId)))
    .get();
  return row ? summary(row) : null;
}

/** Creation is idempotent; only an explicit update replaces an existing snapshot. */
export function publishChatShare(
  chatId: string,
  userId: string,
  update = false,
) {
  return db.transaction(
    (tx) => {
      const existing = tx
        .select(summaryColumns)
        .from(chatShares)
        .where(
          and(eq(chatShares.chatId, chatId), eq(chatShares.userId, userId)),
        )
        .get();
      if (existing && !update) return summary(existing);
      const content = snapshot(tx, chatId, userId);
      if (!content) return null;
      const id = existing?.id ?? crypto.randomUUID();
      const now = new Date(
        Math.max(Date.now(), (existing?.updatedAt.getTime() ?? 0) + 1),
      );
      const row = {
        id,
        chatId,
        userId,
        title: content.title,
        messages: content.messages,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      tx.insert(chatShares)
        .values(row)
        .onConflictDoUpdate({
          target: chatShares.chatId,
          set: { title: row.title, messages: row.messages, updatedAt: now },
        })
        .run();
      tx.delete(chatShareUploads).where(eq(chatShareUploads.shareId, id)).run();
      for (const uploadId of content.fileIds) {
        tx.insert(chatShareUploads).values({ shareId: id, uploadId }).run();
      }
      return summary(row);
    },
    { behavior: "immediate" },
  );
}

export function revokeChatShare(chatId: string, userId: string) {
  db.delete(chatShares)
    .where(and(eq(chatShares.chatId, chatId), eq(chatShares.userId, userId)))
    .run();
}

/** SQLite selects a page; the application never decodes the entire snapshot on reads. */
export function readChatShare(
  id: string,
  cursor?: string,
): SharedConversationPage | null {
  if (cursor && !/^\d{1,16}:\d{1,9}$/.test(cursor))
    throw new ShareBadRequest("Invalid page cursor.");
  return db.transaction((tx) => {
    const row = tx
      .select({
        title: chatShares.title,
        updatedAt: chatShares.updatedAt,
        total: sql<number>`json_array_length(${chatShares.messages})`,
      })
      .from(chatShares)
      .where(eq(chatShares.id, id))
      .get();
    if (!row) return null;
    const [revision, offset = 0] = cursor ? cursor.split(":").map(Number) : [];
    if (revision !== undefined && revision !== row.updatedAt.getTime()) {
      throw new ShareConflict(
        "This shared chat was updated. Reload to see the latest version.",
      );
    }
    if (offset >= row.total && offset !== 0)
      throw new ShareBadRequest("Invalid page cursor.");
    const page = tx
      .all<{ message: string }>(
        sql`
      SELECT item.value AS message FROM chat_shares, json_each(chat_shares.messages) AS item
      WHERE chat_shares.id = ${id} AND item.key >= ${offset}
      ORDER BY item.key LIMIT 50
    `,
      )
      .map((item) => JSON.parse(item.message) as UIMessage);
    // A later user turn can hold the saved state of a form on this page.
    const formMessages = page.length
      ? tx
          .all<{ metadata: string }>(
            sql`
      SELECT json_extract(item.value, '$.metadata') AS metadata
      FROM chat_shares, json_each(chat_shares.messages) AS item
      WHERE chat_shares.id = ${id}
      AND json_extract(item.value, '$.metadata.openuiAction.messageId') IN (${sql.join(
        page.map((m) => sql`${m.id}`),
        sql`, `,
      )})
      ORDER BY item.key
    `,
          )
          .map((item) => ({
            id: "",
            role: "user" as const,
            parts: [],
            metadata: JSON.parse(item.metadata),
          }))
      : [];
    return {
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
      messages: mapUploadReferences(
        page,
        (uploadId) => `/api/share/${id}/files/${uploadId}`,
      ),
      formStates: [...collectOpenUIStates(formMessages)],
      nextCursor:
        offset + page.length < row.total
          ? `${row.updatedAt.getTime()}:${offset + page.length}`
          : null,
    };
  });
}

export function readSharedUpload(shareId: string, uploadId: string) {
  return (
    db
      .select({ upload: uploads })
      .from(chatShareUploads)
      .innerJoin(chatShares, eq(chatShares.id, chatShareUploads.shareId))
      .innerJoin(
        uploads,
        and(
          eq(uploads.id, chatShareUploads.uploadId),
          eq(uploads.userId, chatShares.userId),
        ),
      )
      .where(
        and(
          eq(chatShareUploads.shareId, shareId),
          eq(chatShareUploads.uploadId, uploadId),
        ),
      )
      .get()?.upload ?? null
  );
}
