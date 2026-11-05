import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gmailSentDrafts } from "@/lib/db/schema";

export interface SentGmailDraft {
  draftId: string;
  threadId: string | null;
  sentAt: Date;
}

export function getSentGmailDraft(
  userId: string,
  draftId: string,
): SentGmailDraft | null {
  return getSentGmailDrafts(userId, [draftId])[0] ?? null;
}

/** The ones among `draftIds` that this user has sent from a chat. */
export function getSentGmailDrafts(
  userId: string,
  draftIds: readonly string[],
): SentGmailDraft[] {
  if (draftIds.length === 0) return [];
  return db
    .select({
      draftId: gmailSentDrafts.draftId,
      threadId: gmailSentDrafts.threadId,
      sentAt: gmailSentDrafts.sentAt,
    })
    .from(gmailSentDrafts)
    .where(
      and(
        eq(gmailSentDrafts.userId, userId),
        inArray(gmailSentDrafts.draftId, [...draftIds]),
      ),
    )
    .all();
}

/** Keeps the first record when two requests sent the same draft. */
export function recordSentGmailDraft(input: {
  userId: string;
  draftId: string;
  threadId: string | null;
  sentAt: Date;
}): void {
  db.insert(gmailSentDrafts).values(input).onConflictDoNothing().run();
}
