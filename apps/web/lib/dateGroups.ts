import type { TFunction } from "i18next";

const DAY_MS = 86_400_000;

export type DateBucket =
  | "today"
  | "yesterday"
  | "last7Days"
  | "last30Days"
  | "older";

const ORDER: DateBucket[] = [
  "today",
  "yesterday",
  "last7Days",
  "last30Days",
  "older",
];

const BUCKET_LABEL_KEYS = {
  today: "sidebar.dateGroups.today",
  yesterday: "sidebar.dateGroups.yesterday",
  last7Days: "sidebar.dateGroups.last7Days",
  last30Days: "sidebar.dateGroups.last30Days",
  older: "sidebar.dateGroups.older",
} as const;

export function dateBucketLabel(bucket: DateBucket, t: TFunction): string {
  return t(BUCKET_LABEL_KEYS[bucket]);
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(ts: number, startOfToday: number): DateBucket {
  if (ts >= startOfToday) return "today";
  if (ts >= startOfToday - DAY_MS) return "yesterday";
  if (ts >= startOfToday - 7 * DAY_MS) return "last7Days";
  if (ts >= startOfToday - 30 * DAY_MS) return "last30Days";
  return "older";
}

export function groupByDate<T extends { updatedAt: number }>(
  items: T[],
  t: TFunction,
  now: number = Date.now(),
): { key: DateBucket; label: string; items: T[] }[] {
  const startOfToday = startOfDay(now);
  const map = new Map<DateBucket, T[]>();
  for (const item of items) {
    const b = bucketFor(item.updatedAt, startOfToday);
    const list = map.get(b) ?? [];
    list.push(item);
    map.set(b, list);
  }
  return ORDER.flatMap((key) => {
    const list = map.get(key);
    return list && list.length
      ? [{ key, label: dateBucketLabel(key, t), items: list }]
      : [];
  });
}
