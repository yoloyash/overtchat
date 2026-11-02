import { useMemo } from "react";
import type { UIMessage } from "ai";
import {
  getContextMeterValues,
  type ContextMeterValues,
} from "@overtchat/shared/context-meter";
import { readMessageStats } from "@overtchat/shared/message-stats";
import type { UsageTotals } from "@overtchat/shared/usage";
import { useChatPreferences } from "@/lib/chatPreferences";
import { useChatUsageTotals } from "@/lib/queries/chatUsage";

export interface ChatUsageSummary {
  /** Context-window usage measured at the last response. */
  context?: ContextMeterValues;
  /** Chat generations, present when any of them has a recorded price. */
  session?: UsageTotals;
  /** Image operations, present when any of them has a recorded price. */
  images?: UsageTotals;
}

/**
 * Context usage from the newest assistant message that reported it, plus
 * recorded cost totals for a persisted chat. Honors the device's context-meter
 * and session-cost preferences; `undefined` means there is nothing to show.
 * The result is referentially stable until a reading or the totals change, so
 * it is safe to list as a navigation-options dependency.
 */
export function useChatUsageSummary({
  chatId,
  persisted,
  messages,
  contextWindow,
}: {
  chatId: string;
  persisted: boolean;
  messages: UIMessage[];
  contextWindow?: number;
}): ChatUsageSummary | undefined {
  const prefs = useChatPreferences();
  const costEnabled = persisted && prefs.sessionCost;
  const totals = useChatUsageTotals(chatId, costEnabled);
  const stats = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      const read = readMessageStats(message);
      if (read?.contextTokens !== undefined) return read;
    }
    return undefined;
  }, [messages]);
  const contextTokens = prefs.contextMeter ? stats?.contextTokens : undefined;
  const window = contextWindow ?? stats?.contextWindow;
  const data = costEnabled ? totals.data : undefined;
  return useMemo(() => {
    const context =
      contextTokens !== undefined
        ? getContextMeterValues(contextTokens, window)
        : undefined;
    const session = data?.usage.pricedGenerations ? data.usage : undefined;
    const images = data?.images?.pricedGenerations ? data.images : undefined;
    if (!context && !session && !images) return undefined;
    return { context, session, images };
  }, [contextTokens, window, data]);
}
