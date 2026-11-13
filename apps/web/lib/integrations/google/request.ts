import "server-only";
import {
  discardIntegrationAccessToken,
  getIntegrationAccessToken,
} from "@/lib/integrations/connections";
import {
  IntegrationError,
  IntegrationReconnectError,
} from "@/lib/integrations/errors";
import { googleUrl } from "@/lib/integrations/google/oauth";
import type { IntegrationId } from "@/lib/integrations/schema";

const REQUEST_TIMEOUT_MS = 20_000;

/** One of Google's APIs, and how its failures are worded. */
export interface GoogleService {
  integrationId: IntegrationId;
  /** The product's name, as its errors call it. */
  name: string;
  /** Read by the person in a failed step and by the model, which passes it on. */
  reconnectMessage: string;
  notFoundMessage: string;
}

async function accessToken(
  userId: string,
  service: GoogleService,
): Promise<string> {
  try {
    return await getIntegrationAccessToken(userId, service.integrationId);
  } catch (error) {
    if (error instanceof IntegrationReconnectError) {
      throw new IntegrationReconnectError(service.reconnectMessage);
    }
    throw error;
  }
}

/** Calls one of Google's APIs as the user. A response without a body is `undefined`. */
export async function googleRequest<T>(
  userId: string,
  service: GoogleService,
  url: string,
  options: {
    /** Defaults to POST with a body and GET without one. */
    method?: "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  // A token Google refuses is refreshed once: the grant may still be good.
  for (let attempt = 0; ; attempt += 1) {
    const token = await accessToken(userId, service);
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(googleUrl(url), {
        method: options.method ?? (options.body === undefined ? "GET" : "POST"),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal
          ? AbortSignal.any([timeout, options.signal])
          : timeout,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new IntegrationError(
        `Could not reach ${service.name}. Try again.`,
        502,
      );
    }
    if (response.status === 401 && attempt === 0) {
      discardIntegrationAccessToken(userId, service.integrationId, token);
      continue;
    }
    if (!response.ok) throw await requestError(service, response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

async function requestError(
  service: GoogleService,
  response: Response,
): Promise<IntegrationError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  const detail =
    typeof body?.error?.message === "string" ? body.error.message : "";
  // Google answers 410 for something that was there and has been deleted.
  if (response.status === 404 || response.status === 410) {
    return new IntegrationError(service.notFoundMessage, 404);
  }
  if (response.status === 429) {
    // Google names the limit that was reached, which tells one from another.
    return new IntegrationError(
      `${service.name} is limiting requests for this account. Try again in a minute.${detail ? ` Google said: ${detail}` : ""}`,
      429,
    );
  }
  if (response.status === 403) {
    return new IntegrationError(
      `${service.name} refused the request${detail ? `: ${detail}` : "."}`,
      403,
    );
  }
  return new IntegrationError(
    `${service.name} returned an error${detail ? `: ${detail}` : "."}`,
    502,
  );
}
