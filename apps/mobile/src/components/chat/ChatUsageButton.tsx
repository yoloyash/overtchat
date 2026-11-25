import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { combinePricedUsage, formatNanoUsd } from "@overtchat/shared/usage";
import { ContextRing } from "@/components/ui/ContextRing";
import type { ChatUsageSummary } from "@/lib/chat/useChatUsageSummary";
import { useTheme } from "@/lib/theme";

/**
 * Header action that opens the usage sheet: the context ring, or a cost glyph
 * when the context meter is off but the chat has a recorded cost. Sized like
 * the neighboring header icons.
 */
export function ChatUsageButton({
  usage,
  onPress,
}: {
  usage: ChatUsageSummary;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const cost = combinePricedUsage([usage.session, usage.images]);
  const details = [
    usage.context
      ? usage.context.percentage === undefined
        ? t("chat.usage.contextLimitUnknown")
        : t("chat.usage.contextPercentUsed", { percentage: usage.context.percentage })
      : undefined,
    cost
      ? cost.partial
        ? t("chat.usage.knownSessionCost", { cost: formatNanoUsd(cost.totalCostNanoUsd) })
        : t("chat.usage.sessionCost", { cost: formatNanoUsd(cost.totalCostNanoUsd) })
      : undefined,
  ].filter((detail): detail is string => Boolean(detail));
  const accessibilityLabel =
    details.length >= 2
      ? t("chat.usage.triggerBoth", { first: details[0], second: details[1] })
      : t("chat.usage.triggerSingle", { first: details[0] ?? "" });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ padding: 12, opacity: pressed ? 0.7 : 1 })}
    >
      {usage.context ? (
        <ContextRing values={usage.context} size={22} />
      ) : (
        <Ionicons name="cash-outline" size={22} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}
