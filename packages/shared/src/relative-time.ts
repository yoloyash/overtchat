const DAY_MS = 86_400_000;

/** Compact "last active" label, such as "5m ago", "Yesterday", or "Mar 4". */
export function formatUpdatedAt(ts: number, now: number = Date.now()): string {
  const elapsed = now - ts;
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  if (ts >= startOfToday) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (ts >= startOfToday - DAY_MS) return "Yesterday";
  if (ts >= startOfToday - 6 * DAY_MS) {
    return `${Math.ceil((startOfToday - ts) / DAY_MS)}d ago`;
  }
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
