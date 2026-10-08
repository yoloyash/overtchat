import {
  parseMessageStats,
  isRecord,
  type MessageStats,
} from "@overtchat/shared/message-stats";
export { readMessageStats } from "@overtchat/shared/message-stats";
export type { MessageStats } from "@overtchat/shared/message-stats";
const MESSAGE_STATS_STORAGE_KEY = "overtchat_message_stats";
export type StoredMessageStats = Record<string, MessageStats>;

export function readStoredMessageStats(): StoredMessageStats {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(MESSAGE_STATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([id, value]) => {
          if (!isRecord(value)) return null;
          const stats = parseMessageStats(value);
          return stats ? [id, stats] : null;
        })
        .filter((entry): entry is [string, MessageStats] => entry !== null),
    );
  } catch {
    return {};
  }
}

export function writeStoredMessageStats(stats: StoredMessageStats): void {
  window.localStorage.setItem(MESSAGE_STATS_STORAGE_KEY, JSON.stringify(stats));
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTps(value: number): string {
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} tok/s`;
}
