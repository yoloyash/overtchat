import "server-only";
import type { UIMessage } from "ai";
import { isSavedGmailDraftPart } from "@overtchat/shared";
import {
  getSentGmailDraft,
  getSentGmailDrafts,
  recordSentGmailDraft,
  type SentGmailDraft,
} from "@/lib/db/gmail-drafts";
import { IntegrationError } from "@/lib/integrations/errors";
import { sendGmailDraft } from "@/lib/integrations/google/gmail";

export interface SentDraft {
  at: string;
  threadId: string | null;
}

function toSentDraft(sent: SentGmailDraft): SentDraft {
  return { at: sent.sentAt.toISOString(), threadId: sent.threadId };
}

/**
 * Sends a draft from the user's own mailbox, on the user's request. No model
 * can reach this: it runs only for a signed-in person pressing Send.
 *
 * Asking twice sends once. Gmail removes a draft as it sends it, so a second
 * request finds either the record of the first or no draft at all.
 */
export async function sendSavedGmailDraft(
  userId: string,
  draftId: string,
  signal?: AbortSignal,
): Promise<SentDraft> {
  const already = getSentGmailDraft(userId, draftId);
  if (already) return toSentDraft(already);
  try {
    const { threadId } = await sendGmailDraft(userId, draftId, signal);
    recordSentGmailDraft({ userId, draftId, threadId, sentAt: new Date() });
  } catch (error) {
    // Another request may have sent it while this one was on its way.
    const raced =
      error instanceof IntegrationError && error.status === 404
        ? getSentGmailDraft(userId, draftId)
        : null;
    if (!raced) throw error;
  }
  return toSentDraft(getSentGmailDraft(userId, draftId)!);
}

/**
 * Marks the drafts the user has sent, for the clients that show them. The
 * chat's stored parts are left alone, so what a model reads never changes.
 */
export function withSentGmailDrafts(
  userId: string,
  messages: UIMessage[],
): UIMessage[] {
  const draftIds = messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      isSavedGmailDraftPart(part)
        ? [(part.output as { draftId: string }).draftId]
        : [],
    ),
  );
  if (draftIds.length === 0) return messages;
  const sent = new Map(
    getSentGmailDrafts(userId, draftIds).map((draft) => [draft.draftId, draft]),
  );
  if (sent.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isSavedGmailDraftPart(part)) return part;
      const output = part.output as { draftId: string };
      const record = sent.get(output.draftId);
      return record
        ? ({ ...part, output: { ...output, sent: toSentDraft(record) } } as typeof part)
        : part;
    }),
  })) as UIMessage[];
}
