import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./client";
import { chatGenerations, chats, session, user, voiceSessions } from "./schema";
import * as cancellation from "@/lib/streams/cancel-registry";

const LEASE_MS = 90_000;

export function claimVoiceSession(chatId: string, userId: string, authSessionId: string): string | null {
  return db.transaction((tx) => {
    const chat = tx.select().from(chats).where(eq(chats.id, chatId)).get();
    if (chat && (chat.userId !== userId || chat.activeStreamId)) return null;
    const existing = tx.select().from(voiceSessions).where(eq(voiceSessions.chatId, chatId)).get();
    if (existing && existing.expiresAt.getTime() > Date.now()) return null;
    const id = crypto.randomUUID();
    tx.insert(voiceSessions).values({ chatId, id, userId, authSessionId, expiresAt: new Date(Date.now() + LEASE_MS) })
      .onConflictDoUpdate({ target: voiceSessions.chatId, set: { id, userId, authSessionId, expiresAt: new Date(Date.now() + LEASE_MS) } }).run();
    return id;
  });
}

export function getVoicePrincipal(id: string, chatId: string, userId: string) {
  const row = db.select({ id: user.id, role: user.role, banned: user.banned, banExpires: user.banExpires })
    .from(voiceSessions).innerJoin(session, eq(voiceSessions.authSessionId, session.id))
    .innerJoin(user, eq(voiceSessions.userId, user.id))
    .where(and(eq(voiceSessions.id, id), eq(voiceSessions.chatId, chatId), eq(voiceSessions.userId, userId),
      gt(voiceSessions.expiresAt, new Date()), gt(session.expiresAt, new Date()))).get();
  if (!row || (row.banned && (!row.banExpires || row.banExpires.getTime() > Date.now()))) return null;
  return { id: row.id, role: row.role };
}

export function renewVoiceSession(id: string): void {
  db.update(voiceSessions).set({ expiresAt: new Date(Date.now() + LEASE_MS) })
    .where(and(eq(voiceSessions.id, id), gt(voiceSessions.expiresAt, new Date()))).run();
}

export function endVoiceSession(id: string, userId: string): void {
  db.transaction((tx) => {
    const lease = tx.select().from(voiceSessions).where(and(eq(voiceSessions.id, id), eq(voiceSessions.userId, userId))).get();
    if (!lease) return;
    tx.delete(voiceSessions).where(eq(voiceSessions.id, id)).run();
    const chat = tx.select().from(chats).where(eq(chats.id, lease.chatId)).get();
    if (!chat?.activeStreamId) return;
    const generation = tx.select().from(chatGenerations)
      .where(and(eq(chatGenerations.id, chat.activeStreamId), eq(chatGenerations.chatId, lease.chatId),
        eq(chatGenerations.userId, userId))).get();
    // An expired lease allows a new text turn. Late cleanup may only stop a
    // generation submitted by this voice connection, never its replacement.
    if (generation?.status === "running" && generation.clientRequestId.startsWith(`voice:${id}:`)) {
      cancellation.cancel(generation.id);
    }
  });
}
