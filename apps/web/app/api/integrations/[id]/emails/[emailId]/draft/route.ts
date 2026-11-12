import { auth } from "@/lib/auth/server";
import { saveComposedGmailEmail } from "@/lib/integrations/gmail-emails";
import { gmailEmailContent, gmailEmailId } from "@/lib/integrations/gmail-tools";
import { integrationErrorResponse } from "@/lib/integrations/http";

/**
 * Saves an email a model wrote as a draft in Gmail, when the signed-in user
 * asks for it on the email's card. No tool reaches this.
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
    return Response.json({ error: "This email cannot be saved." }, { status: 400 });
  }

  try {
    const saved = await saveComposedGmailEmail(
      session.user.id,
      emailId,
      content.data,
    );
    return Response.json({ saved });
  } catch (error) {
    return integrationErrorResponse(error);
  }
}
