import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { ChatKind } from "@overtchat/shared";
import { db } from "@/lib/db/client";
import { chats, memories, messages, userPersonalization } from "@/lib/db/schema";

export const EXPORT_VERSION = 3;

export type ExportedMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type ExportedChat = {
  id: string;
  title: string | null;
  kind: ChatKind;
  createdAt: string;
  updatedAt: string;
  messages: ExportedMessage[];
};

export type ExportPayload = {
  format: "overtchat";
  version: number;
  exportedAt: string;
  chats: ExportedChat[];
  personalization?: {
    enabled: boolean;
    preferredName: string | null;
    occupation: string | null;
    about: string | null;
  };
  memories?: Array<{
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

async function loadOne(chatId: string, userId: string): Promise<ExportedChat | null> {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .limit(1);
  if (!chat) return null;

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatId, chatId))
    .orderBy(asc(messages.createdAt));

  return {
    id: chat.id,
    title: chat.title,
    kind: chat.kind,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant" | "system",
      parts: r.parts,
      ...(r.metadata ? { metadata: r.metadata } : {}),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function exportChat(
  chatId: string,
  userId: string,
): Promise<ExportPayload | null> {
  const chat = await loadOne(chatId, userId);
  if (!chat) return null;
  return {
    format: "overtchat",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    chats: [chat],
  };
}

export async function exportAllChats(userId: string): Promise<ExportPayload> {
  const [list, profileRows, memoryRows] = await Promise.all([
    db
      .select({ id: chats.id })
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt)),
    db
      .select({
        enabled: userPersonalization.enabled,
        preferredName: userPersonalization.preferredName,
        occupation: userPersonalization.occupation,
        about: userPersonalization.about,
      })
      .from(userPersonalization)
      .where(eq(userPersonalization.userId, userId))
      .limit(1),
    db
      .select({
        key: memories.key,
        value: memories.value,
        createdAt: memories.createdAt,
        updatedAt: memories.updatedAt,
      })
      .from(memories)
      .where(eq(memories.userId, userId))
      .orderBy(memories.createdAt),
  ]);

  const out: ExportedChat[] = [];
  for (const { id } of list) {
    const chat = await loadOne(id, userId);
    if (chat) out.push(chat);
  }

  return {
    format: "overtchat",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    chats: out,
    ...(profileRows[0] ? { personalization: profileRows[0] } : {}),
    ...(memoryRows.length
      ? {
          memories: memoryRows.map((memory) => ({
            ...memory,
            createdAt: memory.createdAt.toISOString(),
            updatedAt: memory.updatedAt.toISOString(),
          })),
        }
      : {}),
  };
}
