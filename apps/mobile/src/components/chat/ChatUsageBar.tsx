import { useEffect } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import {
  combinePricedUsage,
  type ChatUsageResponse,
  type UsageTotals,
} from "@overtchat/shared/usage";
import { readMessageStats } from "@overtchat/shared/message-stats";
import { getContextMeterValues } from "@overtchat/shared/context-meter";
import { useChatPreferences } from "@/lib/chatPreferences";
import { useTheme } from "@/lib/theme";
import { queryKeys } from "@/lib/queries/keys";
import { settingsRequest } from "@/lib/queries/settings";

const usd = (nanoUsd: number) => `$${(nanoUsd / 1e9).toFixed(4)}`;
const priced = (totals?: UsageTotals) =>
  totals && totals.pricedGenerations > 0 ? totals : undefined;

export function ChatUsageBar({
  chatId,
  persisted,
  streaming,
  messages,
  contextWindow,
}: {
  chatId: string;
  persisted: boolean;
  streaming: boolean;
  messages: UIMessage[];
  contextWindow?: number;
}) {
  const prefs = useChatPreferences();
  const { colors, fonts } = useTheme();
  const usage = useQuery({
    queryKey: queryKeys.chatUsage(chatId),
    queryFn: () => settingsRequest<ChatUsageResponse>(`/chat/${chatId}/usage`),
    enabled: persisted && prefs.sessionCost,
    retry: false,
  });
  const refetch = usage.refetch;
  useEffect(() => {
    if (!streaming && persisted && prefs.sessionCost) void refetch();
  }, [streaming, messages.length, persisted, prefs.sessionCost, refetch]);
  const stats = [...messages]
    .reverse()
    .filter((m) => m.role === "assistant")
    .map(readMessageStats)
    .find((s) => s?.contextTokens !== undefined);
  const context =
    prefs.contextMeter && stats?.contextTokens !== undefined
      ? getContextMeterValues(
          stats.contextTokens,
          contextWindow ?? stats.contextWindow,
        )
      : undefined;
  const chatCost = prefs.sessionCost ? priced(usage.data?.usage) : undefined;
  // Older servers omit image usage.
  const imageCost = prefs.sessionCost ? priced(usage.data?.images) : undefined;
  const cost = combinePricedUsage([chatCost, imageCost]);
  const costText = cost
    ? `${usd(cost.totalCostNanoUsd)}${cost.partial ? "+" : ""}`
    : undefined;
  if (!context && !cost) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Chat usage details"
      onPress={() =>
        Alert.alert(
          "Chat usage",
          [
            context
              ? `${stats!.contextTokens!.toLocaleString()} context tokens${context.percentage === undefined ? " · limit unknown" : ` · ${context.percentage}% of the context window`}. Last reported usage.`
              : "",
            costText
              ? [
                  `Session cost: ${costText}.`,
                  chatCost
                    ? `${chatCost.pricedGenerations} of ${chatCost.generations} generations have pricing.`
                    : "",
                  imageCost
                    ? `Images: ${usd(imageCost.totalCostNanoUsd)} (${imageCost.pricedGenerations} of ${imageCost.generations} priced).`
                    : "",
                  "Missing prices are excluded.",
                ]
                  .filter(Boolean)
                  .join(" ")
              : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        )
      }
      style={{
        paddingHorizontal: 20,
        paddingVertical: 6,
        alignItems: "flex-end",
      }}
    >
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.sansRegular,
          fontSize: 12,
        }}
      >
        {[
          context
            ? `Context ${context.percentage === undefined ? "?" : `${context.percentage}%`}`
            : null,
          costText,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </Pressable>
  );
}
