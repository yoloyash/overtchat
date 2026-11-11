import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { gmailEmails } from "@/lib/db/schema";

export interface GmailEmailRecord {
  emailId: string;
  /** The draft in Gmail, once the user saved the email there. */
  draftId: string | null;
  threadId: string | null;
  sentAt: Date | null;
}

export function getGmailEmail(
  userId: string,
  emailId: string,
): GmailEmailRecord | null {
  return getGmailEmails(userId, [emailId])[0] ?? null;
}

/** The ones among `emailIds` that this user has saved in Gmail or sent. */
export function getGmailEmails(
  userId: string,
  emailIds: readonly string[],
): GmailEmailRecord[] {
  if (emailIds.length === 0) return [];
  return db
    .select({
      emailId: gmailEmails.emailId,
      draftId: gmailEmails.draftId,
      threadId: gmailEmails.threadId,
      sentAt: gmailEmails.sentAt,
    })
    .from(gmailEmails)
    .where(
      and(
        eq(gmailEmails.userId, userId),
        inArray(gmailEmails.emailId, [...emailIds]),
      ),
    )
    .all();
}

/** Keeps the first draft when two requests saved the same email. */
export function recordSavedGmailEmail(input: {
  userId: string;
  emailId: string;
  draftId: string;
}): void {
  db.insert(gmailEmails).values(input).onConflictDoNothing().run();
}

/** Keeps the first record when two requests sent the same email. */
export function recordSentGmailEmail(input: {
  userId: string;
  emailId: string;
  threadId: string | null;
  sentAt: Date;
}): void {
  db.transaction((tx) => {
    // An email saved in Gmail first already has its row.
    tx.insert(gmailEmails)
      .values({ userId: input.userId, emailId: input.emailId })
      .onConflictDoNothing()
      .run();
    tx.update(gmailEmails)
      .set({ threadId: input.threadId, sentAt: input.sentAt })
      .where(
        and(
          eq(gmailEmails.userId, input.userId),
          eq(gmailEmails.emailId, input.emailId),
          isNull(gmailEmails.sentAt),
        ),
      )
      .run();
  });
}
