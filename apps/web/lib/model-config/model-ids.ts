/**
 * The model IDs in what an administrator picked or typed when adding models:
 * separated by commas or line breaks, in order, each one once. Spaces alone do
 * not separate IDs.
 */
export function parseModelIds(text: string): string[] {
  const ids = text
    .split(/[,\n\r]+/)
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** How a set of model IDs is written back into the model field. */
export function formatModelIds(ids: readonly string[]): string {
  return ids.join(", ");
}
