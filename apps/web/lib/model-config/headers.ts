import { i18n } from "@overtchat/shared/i18n";
import { z } from "zod";

/** Replaced in a header value with the ID of the conversation a request is for. */
export const CHAT_ID_PLACEHOLDER = "{{CHAT_ID}}";

export const MAX_MODEL_HEADERS = 32;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 4096;

// RFC 9110 field-name token.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
// Visible ASCII plus inner spaces and tabs: what every HTTP client accepts.
const HEADER_VALUE = /^[\t\x20-\x7E]*$/;

/**
 * Headers that describe the request the app builds, or the connection that
 * carries it. Overriding them breaks the request instead of configuring it.
 */
const RESERVED_HEADER_NAMES = new Set([
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type ModelHeaders = Record<string, string>;

/**
 * Extra request headers an administrator sets on a model's connection. Names
 * and values are trimmed; an empty object is stored as null.
 */
export const ModelHeadersSchema = z
  .record(z.string(), z.string())
  .nullable()
  .transform((value, context): ModelHeaders | null => {
    if (!value) return null;
    const entries = Object.entries(value).map(
      ([name, headerValue]) => [name.trim(), headerValue.trim()] as const,
    );
    if (entries.length > MAX_MODEL_HEADERS) {
      context.addIssue({
        code: "custom",
        message: i18n.t("models.editor.errors.tooManyHeaders", {
          max: MAX_MODEL_HEADERS,
        }),
      });
      return z.NEVER;
    }
    const seen = new Set<string>();
    for (const [name, headerValue] of entries) {
      const message = headerIssue(name, headerValue, seen);
      if (message) {
        context.addIssue({ code: "custom", path: [name], message });
        return z.NEVER;
      }
      seen.add(name.toLowerCase());
    }
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  });

function headerIssue(
  name: string,
  value: string,
  seen: Set<string>,
): string | undefined {
  if (!name) return i18n.t("models.editor.errors.emptyHeaderName");
  if (name.length > MAX_HEADER_NAME_LENGTH || !HEADER_NAME.test(name)) {
    return i18n.t("models.editor.errors.invalidHeaderName", {
      name: name.slice(0, 40),
    });
  }
  const lower = name.toLowerCase();
  if (RESERVED_HEADER_NAMES.has(lower)) {
    return i18n.t("models.editor.errors.reservedHeaderName", { name });
  }
  if (seen.has(lower)) {
    return i18n.t("models.editor.errors.duplicateHeaderName", { name });
  }
  if (!value) {
    return i18n.t("models.editor.errors.missingHeaderValue", { name });
  }
  if (value.length > MAX_HEADER_VALUE_LENGTH) {
    return i18n.t("models.editor.errors.headerValueTooLong", { name });
  }
  if (!HEADER_VALUE.test(value)) {
    return i18n.t("models.editor.errors.invalidHeaderValue", { name });
  }
  return undefined;
}

/**
 * The header map an editor's rows describe. Rows without a name are ignored;
 * a repeated name is reported here because an object cannot hold it twice.
 */
export function modelHeadersFromRows(
  rows: ReadonlyArray<{ key: string; value: string }>,
): { headers: ModelHeaders | null; error?: string } {
  const named = rows
    .map((row) => [row.key.trim(), row.value.trim()] as const)
    .filter(([name]) => name);
  const seen = new Set<string>();
  for (const [name] of named) {
    if (seen.has(name.toLowerCase())) {
      return {
        headers: null,
        error: i18n.t("models.editor.errors.duplicateHeaderName", { name }),
      };
    }
    seen.add(name.toLowerCase());
  }
  const parsed = ModelHeadersSchema.safeParse(Object.fromEntries(named));
  return parsed.success
    ? { headers: parsed.data }
    : { headers: null, error: parsed.error.issues[0]?.message };
}
