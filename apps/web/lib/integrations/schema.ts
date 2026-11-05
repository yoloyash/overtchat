import { z } from "zod";

/**
 * Integrations connect a user's own account on an outside service. They are
 * unrelated to the Host Connector, which runs coding agents.
 */
export const INTEGRATION_PROVIDERS = ["google"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_IDS = ["gmail"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export const INTEGRATION_CONNECTION_STATUSES = [
  "connected",
  // The grant was revoked or expired; only a new sign-in restores it.
  "needs_reconnect",
] as const;
export type IntegrationConnectionStatus =
  (typeof INTEGRATION_CONNECTION_STATUSES)[number];

interface IntegrationDefinition {
  provider: IntegrationProvider;
  /** Every scope must be granted; a partial grant is refused. */
  scopes: readonly string[];
}

export const INTEGRATIONS: Record<IntegrationId, IntegrationDefinition> = {
  gmail: {
    provider: "google",
    // One scope covers reading, drafting and labels. It also permits sending
    // and moving mail to the trash, which no tool does.
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  },
};

export function isIntegrationId(value: string): value is IntegrationId {
  return (INTEGRATION_IDS as readonly string[]).includes(value);
}

export interface IntegrationConnection {
  accountEmail: string;
  status: IntegrationConnectionStatus;
  connectedAt: string;
}

/** What one user may know about an integration. Never carries tokens. */
export interface Integration {
  id: IntegrationId;
  /** Whether an administrator has supplied the provider's OAuth client. */
  configured: boolean;
  connection: IntegrationConnection | null;
}

/** The administrator's view of a provider's OAuth client. Never the secret. */
export interface IntegrationOauthClient {
  provider: IntegrationProvider;
  clientId: string | null;
  clientSecretSet: boolean;
}

export const IntegrationOauthClientInputSchema = z.object({
  clientId: z
    .string()
    .trim()
    .min(1, "Client ID is required")
    .max(512, "Client ID is too long"),
  /** Empty keeps the stored secret, so editing never needs it re-entered. */
  clientSecret: z.string().trim().max(512, "Client secret is too long"),
});
export type IntegrationOauthClientInput = z.infer<
  typeof IntegrationOauthClientInputSchema
>;

export const IntegrationConnectInputSchema = z.object({
  /** The address the browser ended on after the user approved access. */
  redirectUrl: z
    .string()
    .trim()
    .min(1, "Paste the address from your browser")
    .max(4096, "That address is too long"),
});
export type IntegrationConnectInput = z.infer<
  typeof IntegrationConnectInputSchema
>;
