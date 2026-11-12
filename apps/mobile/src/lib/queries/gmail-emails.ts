import {
  apiError,
  rememberGmailEmailResult,
  type GmailEmailContent,
  type GmailEmailDisplay,
} from "@overtchat/shared";
import { useMutation } from "@tanstack/react-query";
import { authFetch, getApiBase } from "@/lib/api";

async function postGmailEmail<T>(
  path: string,
  content: GmailEmailContent | undefined,
): Promise<T> {
  const response = await authFetch(`${getApiBase()}/api/integrations/gmail/${path}`, {
    method: "POST",
    ...(content
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(content),
        }
      : {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw apiError(
      response.status,
      body,
      "Could not complete the request. Please try again.",
    );
  }
  return (await response.json()) as T;
}

/** What a card needs of its email to send or save it. */
export type GmailEmailRef = Pick<GmailEmailDisplay, "id" | "source" | "content">;

/**
 * Sends an email a model wrote: a draft it saved in Gmail by that draft's
 * ID, and an email only the chat holds with what it says.
 */
export async function sendGmailEmail({ id, source, content }: GmailEmailRef) {
  const { sent } = await postGmailEmail<{
    sent: { at: string; threadId: string | null };
  }>(
    `${source === "draft" ? "drafts" : "emails"}/${encodeURIComponent(id)}/send`,
    source === "draft" ? undefined : content,
  );
  // Kept outside the card, which the list may have recycled by now.
  rememberGmailEmailResult(id, { sent });
  return sent;
}

/** Saves an email only the chat holds as a draft in the user's Gmail. */
export async function saveGmailEmail({ id, content }: GmailEmailRef) {
  const { saved } = await postGmailEmail<{ saved: { draftId: string } }>(
    `emails/${encodeURIComponent(id)}/draft`,
    content,
  );
  rememberGmailEmailResult(id, { saved });
  return saved;
}

export function useSendGmailEmail() {
  return useMutation({ mutationFn: sendGmailEmail });
}

export function useSaveGmailEmail() {
  return useMutation({ mutationFn: saveGmailEmail });
}
