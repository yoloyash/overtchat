import "server-only";
import { eq, sql } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db/client";
import { chats, messages, projects } from "@/lib/db/schema";
import { extractSearchText } from "@/lib/search/extract";

export type SyncVoiceHistoryResult =
  | {
      status: "ok";
      createdChat: boolean;
      changed: boolean;
      firstUserParts: UIMessage["parts"] | null;
    }
  | { status: "not-found" | "wrong-kind" | "invalid-project" };

export function syncVoiceHistory({
  chatId,
  userId,
  projectId,
  allowCreate,
  history,
}: {
  chatId: string;
  userId: string;
  projectId: string | null;
  allowCreate: boolean;
  history: UIMessage[];
}): SyncVoiceHistoryResult {
  return db.transaction((tx) => {
    const existingChat = tx
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1)
      .get();
    if (existingChat && existingChat.userId !== userId) {
      return { status: "not-found" as const };
    }
    if (existingChat?.kind === "text") {
      return { status: "wrong-kind" as const };
    }

    const existingMessages = new Map<
      string,
      { chatId: string; role: string; parts: UIMessage["parts"] }
    >();
    for (const message of history) {
      const existingMessage = tx
        .select({
          chatId: messages.chatId,
          role: messages.role,
          parts: messages.parts,
        })
        .from(messages)
        .where(eq(messages.id, message.id))
        .limit(1)
        .get();
      if (!existingMessage) continue;
      if (
        existingMessage.chatId !== chatId ||
        existingMessage.role !== message.role
      ) {
        return { status: "not-found" as const };
      }
      existingMessages.set(message.id, existingMessage);
    }

    let createdChat = false;
    if (!existingChat) {
      if (!allowCreate) return { status: "not-found" as const };
      if (projectId) {
        const project = tx
          .select({ userId: projects.userId })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
          .get();
        if (!project || project.userId !== userId) {
          return { status: "invalid-project" as const };
        }
      }
      tx.insert(chats)
        .values({
          id: chatId,
          userId,
          projectId,
          kind: "voice",
          title: null,
        })
        .run();
      createdChat = true;
    }

    let changed = false;
    let firstUserParts: UIMessage["parts"] | null = null;
    for (const message of history) {
      const existingMessage = existingMessages.get(message.id);
      if (existingMessage) {
        if (JSON.stringify(existingMessage.parts) === JSON.stringify(message.parts)) {
          continue;
        }
        tx.update(messages)
          .set({ parts: message.parts })
          .where(eq(messages.id, message.id))
          .run();
      } else {
        tx.insert(messages)
          .values({
            id: message.id,
            chatId,
            role: message.role,
            parts: message.parts,
          })
          .run();
        if (message.role === "user" && firstUserParts === null) {
          firstUserParts = message.parts;
        }
      }

      tx.run(sql`
        DELETE FROM messages_fts
        WHERE message_id = ${message.id}
      `);
      const content = extractSearchText(message.parts);
      if (content) {
        tx.run(sql`
          INSERT INTO messages_fts (content, message_id, chat_id, user_id)
          VALUES (${content}, ${message.id}, ${chatId}, ${userId})
        `);
      }
      changed = true;
    }

    if (changed) {
      tx.update(chats)
        .set({ updatedAt: new Date() })
        .where(eq(chats.id, chatId))
        .run();
    }
    return {
      status: "ok" as const,
      createdChat,
      changed,
      firstUserParts,
    };
  });
}
