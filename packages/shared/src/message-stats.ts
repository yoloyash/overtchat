import type { UIMessage } from "ai";
import { MODEL_BRAND_ICON_IDS, type ModelBrandIconId } from "./models";

export interface MessageStats {
  /** Latest-step input plus output: the approximate footprint of the next turn. */
  contextTokens?: number;
  contextWindow?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  uncachedInputTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  ttftMs?: number;
  tps?: number;
  finishReason?: string;
  providerLabel?: string;
  providerIconId?: ModelBrandIconId;
  model?: string;
  modelIconId?: ModelBrandIconId;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function optionalIconId(value: unknown): ModelBrandIconId | undefined {
  const iconId = optionalString(value);
  return iconId !== undefined &&
    MODEL_BRAND_ICON_IDS.includes(iconId as ModelBrandIconId)
    ? (iconId as ModelBrandIconId)
    : undefined;
}

export function readMessageStats(message: UIMessage): MessageStats | null {
  if (!isRecord(message.metadata)) return null;
  return parseMessageStats(message.metadata.stats);
}

export function parseMessageStats(rawStats: unknown): MessageStats | null {
  if (!isRecord(rawStats)) return null;
  const stats: MessageStats = {
    contextTokens: optionalNumber(rawStats.contextTokens),
    contextWindow: optionalPositiveInteger(rawStats.contextWindow),
    cacheReadTokens: optionalNumber(rawStats.cacheReadTokens),
    cacheWriteTokens: optionalNumber(rawStats.cacheWriteTokens),
    uncachedInputTokens: optionalNumber(rawStats.uncachedInputTokens),
    responseTokens: optionalNumber(rawStats.responseTokens),
    totalTokens: optionalNumber(rawStats.totalTokens),
    ttftMs: optionalNumber(rawStats.ttftMs),
    tps: optionalNumber(rawStats.tps),
    finishReason: optionalString(rawStats.finishReason),
    providerLabel: optionalString(rawStats.providerLabel),
    providerIconId: optionalIconId(rawStats.providerIconId),
    model: optionalString(rawStats.model),
    modelIconId: optionalIconId(rawStats.modelIconId),
  };
  return Object.values(stats).some((value) => value !== undefined)
    ? stats
    : null;
}
