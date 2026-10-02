/**
 * Reads an optional search param. The router parses every param as a string,
 * so anything else means the param is absent.
 */
export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
