import "server-only";
import { IntegrationError } from "@/lib/integrations/errors";

/**
 * Answers with an integration failure's own message and status. The body has
 * no `code`: clients show an API error's text only when it is uncoded.
 */
export function integrationErrorResponse(error: unknown): Response {
  if (error instanceof IntegrationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
