import "server-only";
import type { UIMessage } from "ai";
import {
  isComposedGmailEmailPart,
  type GmailEmailContent,
} from "@overtchat/shared";
import {
  getGmailEmail,
  getGmailEmails,
  recordSavedGmailEmail,
  recordSentGmailEmail,
  type GmailEmailRecord,
} from "@/lib/db/gmail-emails";
import { IntegrationError } from "@/lib/integrations/errors";
import { withSentGmailDrafts, type SentDraft } from "@/lib/integrations/gmail-drafts";
import {
  createGmailDraft,
  sendGmailDraft,
  sendGmailEmail,
} from "@/lib/integrations/google/gmail";

export interface SavedEmail {
  draftId: string;
}

function toSent(record: GmailEmailRecord): SentDraft | null {
  return record.sentAt
    ? { at: record.sentAt.toISOString(), threadId: record.threadId }
    : null;
}

/**
 * Requests for one email that have not finished. Gmail has no way to refuse
 * a second copy of an email, so a second request waits for the first and
 * then reads what it recorded.
 */
const pending = new Map<string, Promise<unknown>>();

async function oneAtATime<T>(
  userId: string,
  emailId: string,
  act: () => Promise<T>,
): Promise<T> {
  const key = `${userId}\n${emailId}`;
  for (let earlier = pending.get(key); earlier; earlier = pending.get(key)) {
    await earlier.catch(() => {});
  }
  const running = act();
  pending.set(key, running);
  try {
    return await running;
  } finally {
    if (pending.get(key) === running) pending.delete(key);
  }
}

/**
 * Sends an email a model wrote, on the user's request. No model can reach
 * this: it runs only for a signed-in person pressing Send.
 *
 * Asking twice sends once. An email the user saved in Gmail is sent as it
 * stands there now, with any edits they made.
 */
export function sendComposedGmailEmail(
  userId: string,
  emailId: string,
  content: GmailEmailContent,
): Promise<SentDraft> {
  return oneAtATime(userId, emailId, async () => {
    const record = getGmailEmail(userId, emailId);
    const already = record && toSent(record);
    if (already) return already;
    const { threadId } = record?.draftId
      ? await sendGmailDraft(userId, record.draftId)
      : await sendGmailEmail(userId, content);
    recordSentGmailEmail({ userId, emailId, threadId, sentAt: new Date() });
    return toSent(getGmailEmail(userId, emailId)!)!;
  });
}

/**
 * Saves an email a model wrote as a draft in the user's Gmail, on the user's
 * request, so they can edit it there. Asking twice saves one draft.
 */
export function saveComposedGmailEmail(
  userId: string,
  emailId: string,
  content: GmailEmailContent,
): Promise<SavedEmail> {
  return oneAtATime(userId, emailId, async () => {
    const record = getGmailEmail(userId, emailId);
    if (record?.sentAt) {
      throw new IntegrationError("This email has already been sent.", 409);
    }
    if (record?.draftId) return { draftId: record.draftId };
    const { draftId } = await createGmailDraft(userId, content);
    recordSavedGmailEmail({ userId, emailId, draftId });
    return { draftId };
  });
}

/**
 * Marks the emails the user has saved in Gmail or sent, for the clients that
 * show them. The chat's stored parts are left alone, so what a model reads
 * never changes.
 */
export function withGmailEmailState(
  userId: string,
  messages: UIMessage[],
): UIMessage[] {
  messages = withSentGmailDrafts(userId, messages);
  const emailIds = messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isComposedGmailEmailPart(part)
        ? [(part.output as { emailId: string }).emailId]
        : [],
    ),
  );
  if (emailIds.length === 0) return messages;
  const records = new Map(
    getGmailEmails(userId, emailIds).map((record) => [record.emailId, record]),
  );
  if (records.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isComposedGmailEmailPart(part)) return part;
      const output = part.output as { emailId: string };
      const record = records.get(output.emailId);
      if (!record) return part;
      const sent = toSent(record);
      return {
        ...part,
        output: {
          ...output,
          ...(record.draftId ? { saved: { draftId: record.draftId } } : {}),
          ...(sent ? { sent } : {}),
        },
      } as typeof part;
    }),
  })) as UIMessage[];
}
