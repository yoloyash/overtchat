import type { AgentTranscriptItem } from "@overtchat/shared/agent-presentation";

function sameValue(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  // Treat unusually deep values as changed rather than walking them.
  if (depth > 10) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    for (let index = 0; index < a.length; index++)
      if (!sameValue(a[index], b[index], depth + 1)) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys)
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !sameValue(left[key], right[key], depth + 1)
    )
      return false;
  return true;
}

/**
 * Reuses the previous row object when a projected row is unchanged, so
 * memoized transcript rows skip rendering while other rows stream.
 */
export function stabilizeTranscriptItems(
  previous: ReadonlyMap<string, AgentTranscriptItem>,
  items: readonly AgentTranscriptItem[],
): { items: AgentTranscriptItem[]; byKey: Map<string, AgentTranscriptItem> } {
  const byKey = new Map<string, AgentTranscriptItem>();
  const stable = items.map((item) => {
    const prior = previous.get(item.key);
    const next = prior && sameValue(prior, item, 0) ? prior : item;
    byKey.set(item.key, next);
    return next;
  });
  return { items: stable, byKey };
}

/** Stabilizes successive projections of one transcript. */
export function createTranscriptStabilizer() {
  let previous = new Map<string, AgentTranscriptItem>();
  return (items: readonly AgentTranscriptItem[]) => {
    const result = stabilizeTranscriptItems(previous, items);
    previous = result.byKey;
    return result.items;
  };
}

export function formatAgentElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
