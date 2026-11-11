import { auth } from "@/lib/auth/server";
import { sendComposedGmailEmail } from "@/lib/integrations/gmail-emails";
import { gmailEmailContent, gmailEmailId } from "@/lib/integrations/gmail-tools";
import { integrationErrorResponse } from "@/lib/integrations/http";

/**
 * Sends an email a model wrote, when the signed-in user presses Send on it.
 * Sending is the user's act alone, so there is no tool that reaches this.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; emailId: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id, emailId } = await params;
  if (id !== "gmail" || !gmailEmailId.safeParse(emailId).success) {
    return new Response("Not found", { status: 404 });
  }
  const content = gmailEmailContent.safeParse(
    await request.json().catch(() => null),
  );
  if (!content.success) {
    return Response.json({ error: "This email cannot be sent." }, { status: 400 });
  }

  try {
    // Not tied to the request: a send the user started finishes and is
    // recorded even if their browser has moved on.
    const sent = await sendComposedGmailEmail(
      session.user.id,
      emailId,
      content.data,
    );
    return Response.json({ sent });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
