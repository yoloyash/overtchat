import { auth } from "@/lib/auth/server";
import { sendSavedGmailDraft } from "@/lib/integrations/gmail-drafts";
import { integrationErrorResponse } from "@/lib/integrations/http";

/** Gmail's own draft IDs, which are also part of its API's request. */
const DRAFT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Sends a draft a model saved, when the signed-in user presses Send on it.
 * Sending is the user's act alone, so there is no tool that reaches this.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; draftId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id, draftId } = await params;
  if (id !== "gmail" || !DRAFT_ID.test(draftId)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    // Not tied to the request: a send the user started finishes and is
    // recorded even if their browser has moved on.
    const sent = await sendSavedGmailDraft(session.user.id, draftId);
    return Response.json({ sent });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
