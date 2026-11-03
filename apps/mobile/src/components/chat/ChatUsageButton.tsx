import { Ionicons } from "@expo/vector-icons";
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
  const cost = combinePricedUsage([usage.session, usage.images]);
  const details = [
    usage.context
      ? usage.context.percentage === undefined
        ? "context limit unknown"
        : `${usage.context.percentage}% context used`
      : undefined,
    cost
      ? `${cost.partial ? "known session cost" : "session cost"} ${formatNanoUsd(cost.totalCostNanoUsd)}`
      : undefined,
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Usage: ${details.join("; ")}. Show details`}
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
