import { useEffect } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { ChatUsageResponse } from "@overtchat/shared/usage";
import { readMessageStats } from "@overtchat/shared/message-stats";
import { getContextMeterValues } from "@overtchat/shared/context-meter";
import { useChatPreferences } from "@/lib/chatPreferences";
import { useTheme } from "@/lib/theme";
import { queryKeys } from "@/lib/queries/keys";
import { settingsRequest } from "@/lib/queries/settings";
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
  const cost =
    prefs.sessionCost && usage.data?.usage.pricedGenerations
      ? usage.data.usage
      : undefined;
  const costText = cost
    ? `$${(cost.totalCostNanoUsd / 1e9).toFixed(4)}${cost.pricedGenerations < cost.generations ? "+" : ""}`
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
              ? `Session cost: ${costText}. ${cost!.pricedGenerations} of ${cost!.generations} generations have pricing. Missing prices are excluded.`
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
