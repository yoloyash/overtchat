import { i18n } from "./i18n/i18n";

const DAY_MS = 86_400_000;

/** Compact "last active" label, such as "5m ago", "Yesterday", or "Mar 4". */
export function formatUpdatedAt(ts: number, now: number = Date.now()): string {
  const elapsed = now - ts;
  if (elapsed < 60_000) return i18n.t("common.relativeTime.justNow");
  if (elapsed < 3_600_000) {
    return i18n.t("common.relativeTime.minutesAgo", { minutes: Math.floor(elapsed / 60_000) });
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  if (ts >= startOfToday) {
    return i18n.t("common.relativeTime.hoursAgo", { hours: Math.floor(elapsed / 3_600_000) });
  }
  if (ts >= startOfToday - DAY_MS) return i18n.t("common.relativeTime.yesterday");
  if (ts >= startOfToday - 6 * DAY_MS) {
    return i18n.t("common.relativeTime.daysAgo", {
      days: Math.ceil((startOfToday - ts) / DAY_MS),
    });
  }
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
