import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { CHAT_ID_PLACEHOLDER } from "@/lib/model-config/headers";
import type { ProviderConnection } from "@/lib/providers/server/types";

/**
 * The extra headers to send on a connection's requests, with placeholders
 * filled in. Returns undefined when the connection has none.
 *
 * `{{CHAT_ID}}` becomes the chat's ID, so gateways that route or cache by
 * conversation get a stable value. Chat IDs come from clients, so one that a
 * header cannot carry is sent as its digest instead. Requests outside a chat,
 * such as model discovery and connection tests, get a fresh ID: gateways that
 * require the header reject an empty value.
 */
export function connectionHeaders(
  connection: Pick<ProviderConnection, "headers" | "chatId">,
): Record<string, string> | undefined {
  const entries = Object.entries(connection.headers ?? {});
  if (entries.length === 0) return undefined;
  let conversationId: string | undefined;
  return Object.fromEntries(
    entries.map(([name, value]) => [
      name,
      value.includes(CHAT_ID_PLACEHOLDER)
        ? value.replaceAll(
            CHAT_ID_PLACEHOLDER,
            (conversationId ??= conversationIdFor(connection.chatId)),
          )
        : value,
    ]),
  );
}

// Visible ASCII without spaces, short enough for any header.
const HEADER_SAFE_ID = /^[\x21-\x7E]{1,128}$/;

function conversationIdFor(chatId: string | undefined): string {
  if (!chatId) return randomUUID();
  return HEADER_SAFE_ID.test(chatId)
    ? chatId
    : createHash("sha256").update(chatId).digest("base64url");
}

/**
 * `base` with the connection's headers set on top. A custom header replaces
 * any header of the same name, whatever its case, so an administrator can
 * override the authentication the app would send.
 */
export function applyHeaders(
  base: HeadersInit | undefined,
  headers: Record<string, string> | null | undefined,
): Headers {
  const merged = new Headers(base);
  for (const [name, value] of Object.entries(headers ?? {})) {
    merged.set(name, value);
  }
  return merged;
}

/** A `fetch` for SDK clients that sends the connection's headers. */
export function fetchWithHeaders(
  headers: Record<string, string> | null | undefined,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  if (!headers || Object.keys(headers).length === 0) return fetcher;
  return (input, init) =>
    fetcher(input, { ...init, headers: applyHeaders(init?.headers, headers) });
}
