import type { UIMessage } from "ai";

const MESSAGE_STATS_STORAGE_KEY = "overtchat_message_stats";

export interface MessageStats {
  contextTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  ttftMs?: number;
  tps?: number;
  finishReason?: string;
}

export type StoredMessageStats = Record<string, MessageStats>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

export function readMessageStats(message: UIMessage): MessageStats | null {
  if (!isRecord(message.metadata)) return null;
  const rawStats = message.metadata.stats;
  if (!isRecord(rawStats)) return null;
  const stats: MessageStats = {
    contextTokens: optionalNumber(rawStats.contextTokens),
    responseTokens: optionalNumber(rawStats.responseTokens),
    totalTokens: optionalNumber(rawStats.totalTokens),
    ttftMs: optionalNumber(rawStats.ttftMs),
    tps: optionalNumber(rawStats.tps),
    finishReason: optionalString(rawStats.finishReason),
  };
  return Object.values(stats).some((value) => value !== undefined)
    ? stats
    : null;
}

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
          const stats: MessageStats = {
            contextTokens: optionalNumber(value.contextTokens),
            responseTokens: optionalNumber(value.responseTokens),
            totalTokens: optionalNumber(value.totalTokens),
            ttftMs: optionalNumber(value.ttftMs),
            tps: optionalNumber(value.tps),
            finishReason: optionalString(value.finishReason),
          };
          return Object.values(stats).some((v) => v !== undefined)
            ? [id, stats]
            : null;
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
