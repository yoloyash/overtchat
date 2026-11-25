import { i18n } from "@overtchat/shared/i18n";

const DAY_MS = 86_400_000;

export type DateBucket =
  | "Today"
  | "Yesterday"
  | "Last 7 days"
  | "Last 30 days"
  | "Older";

const ORDER: DateBucket[] = [
  "Today",
  "Yesterday",
  "Last 7 days",
  "Last 30 days",
  "Older",
];

export const DATE_BUCKET_KEYS = {
  Today: "sidebar.dateGroups.today",
  Yesterday: "sidebar.dateGroups.yesterday",
  "Last 7 days": "sidebar.dateGroups.last7Days",
  "Last 30 days": "sidebar.dateGroups.last30Days",
  Older: "sidebar.dateGroups.older",
} as const;

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(ts: number, startOfToday: number): DateBucket {
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - DAY_MS) return "Yesterday";
  if (ts >= startOfToday - 7 * DAY_MS) return "Last 7 days";
  if (ts >= startOfToday - 30 * DAY_MS) return "Last 30 days";
  return "Older";
}

export function groupByDate<T extends { updatedAt: number }>(
  items: T[],
  now: number = Date.now(),
): { bucket: DateBucket; label: string; items: T[] }[] {
  const startOfToday = startOfDay(now);
  const map = new Map<DateBucket, T[]>();
  for (const item of items) {
    const b = bucketFor(item.updatedAt, startOfToday);
    const list = map.get(b) ?? [];
    list.push(item);
    map.set(b, list);
  }
  return ORDER.flatMap((bucket) => {
    const list = map.get(bucket);
    return list && list.length
      ? [{ bucket, label: i18n.t(DATE_BUCKET_KEYS[bucket]), items: list }]
      : [];
  });
}
