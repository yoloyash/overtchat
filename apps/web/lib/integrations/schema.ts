import { z } from "zod";

/**
 * Integrations connect a user's own account on an outside service. They are
 * unrelated to the Host Connector, which runs coding agents.
 */
export const INTEGRATION_PROVIDERS = ["google"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_IDS = ["gmail", "calendar"] as const;
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
  /** A sign-in covers this integration only when it was granted all of these. */
  scopes: readonly string[];
}

export const INTEGRATIONS: Record<IntegrationId, IntegrationDefinition> = {
  gmail: {
    provider: "google",
    // One scope covers reading, drafting and labels, the trash included. It
    // also permits sending, which no tool does.
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  },
  calendar: {
    provider: "google",
    // Reading and changing events on any of the user's calendars. It also
    // permits changing a calendar's sharing and deleting one, which no tool
    // does.
    scopes: ["https://www.googleapis.com/auth/calendar"],
  },
};

export function isIntegrationId(value: string): value is IntegrationId {
  return (INTEGRATION_IDS as readonly string[]).includes(value);
}

export function isIntegrationProvider(
  value: string,
): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

/** The integrations one sign-in to this provider can cover. */
export function providerIntegrations(
  provider: IntegrationProvider,
): IntegrationId[] {
  return INTEGRATION_IDS.filter((id) => INTEGRATIONS[id].provider === provider);
}

/**
 * The integrations a sign-in covers. The user picks them before signing in and
 * can still untick any of them on the provider's own page.
 */
export function grantedIntegrations(
  provider: IntegrationProvider,
  scopes: readonly string[],
): IntegrationId[] {
  return providerIntegrations(provider).filter((id) =>
    INTEGRATIONS[id].scopes.every((scope) => scopes.includes(scope)),
  );
}

export interface IntegrationConnection {
  accountEmail: string;
  status: IntegrationConnectionStatus;
  connectedAt: string;
  /** Whether every chat is offered the tools, or only chats that ask. */
  alwaysOn: boolean;
}

/** What one user may know about an integration. Never carries tokens. */
export interface Integration {
  id: IntegrationId;
  /** Integrations of one provider share a single sign-in. */
  provider: IntegrationProvider;
  /** Whether an administrator has supplied the provider's OAuth client. */
  configured: boolean;
  /** Null when the user's sign-in, if any, does not cover this integration. */
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

export const IntegrationAuthorizationInputSchema = z.object({
  /** What the sign-in should cover. It replaces any earlier sign-in. */
  integrations: z
    .array(z.enum(INTEGRATION_IDS))
    .min(1, "Choose at least one thing to connect"),
});
export type IntegrationAuthorizationInput = z.infer<
  typeof IntegrationAuthorizationInputSchema
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

export const IntegrationSettingsInputSchema = z.object({
  alwaysOn: z.boolean(),
});
export type IntegrationSettingsInput = z.infer<
  typeof IntegrationSettingsInputSchema
>;
