import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chats, messages } from "@/lib/db/schema";

export const EXPORT_VERSION = 1;

export type ExportedMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  parts: unknown;
  createdAt: string;
};

export type ExportedChat = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ExportedMessage[];
};

export type ExportPayload = {
  format: "overtchat";
  version: number;
  exportedAt: string;
  chats: ExportedChat[];
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
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    messages: rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant" | "system",
      parts: r.parts,
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
  const list = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));

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
  };
}
