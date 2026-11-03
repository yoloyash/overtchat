import { Pressable, Text, View } from "react-native";
import type { AgentSessionStats } from "@overtchat/agent-bridge";
import { getContextMeterValues } from "@overtchat/shared/context-meter";
import { ContextRing } from "@/components/ui/ContextRing";
import { useTheme } from "@/lib/theme";
import { AgentSheet, AgentText } from "./AgentPrimitives";

type ContextUsage = AgentSessionStats["contextUsage"];

function contextValues(usage: ContextUsage) {
  return usage?.tokens != null && Number.isFinite(usage.tokens)
    ? getContextMeterValues(usage.tokens, usage.contextWindow)
    : undefined;
}

export function AgentContextButton({
  usage,
  onPress,
}: {
  usage: ContextUsage;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const values = contextValues(usage);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        values?.percentage !== undefined
          ? `Context: ${values.percentage}% used. Show details`
          : "Context usage unavailable. Show details"
      }
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <ContextRing values={values} />
    </Pressable>
  );
}

export function AgentContextSheet({
  usage,
  visible,
  onClose,
  stale = false,
}: {
  usage: ContextUsage;
  visible: boolean;
  onClose: () => void;
  stale?: boolean;
}) {
  const { colors, fonts } = useTheme();
  const values = contextValues(usage);
  const limit =
    usage && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
      ? usage.contextWindow
      : undefined;
  const rows = [
    ["Used", values?.usedTokens],
    ["Remaining", values?.remainingTokens],
    ["Context window", limit],
  ] as const;
  return (
    <AgentSheet
      title="Context usage"
      visible={visible}
      onClose={onClose}
      closeLabel="Close context usage"
      snapPoints={["45%", "70%"]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 12,
        }}
      >
        <ContextRing values={values} size={40} />
        <AgentText title>
          {values?.percentage !== undefined
            ? `${values.percentage}% used`
            : "Usage unavailable"}
        </AgentText>
      </View>
      <View style={{ gap: 16 }}>
        {rows.map(([label, value]) => (
          <View
            key={label}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <AgentText muted>{label}</AgentText>
            <Text
              selectable
              style={{
                color: colors.foreground,
                fontFamily: fonts.mono,
                fontSize: 14,
              }}
            >
              {value === undefined
                ? "—"
                : `${Math.round(value).toLocaleString()} tokens`}
            </Text>
          </View>
        ))}
      </View>
      {values?.percentage === undefined && (
        <AgentText muted>
          {values
            ? "The agent hasn't reported a context limit."
            : "The agent hasn't reported context usage yet."}
        </AgentText>
      )}
      {stale && (
        <AgentText muted>
          Last reported usage. Updates resume when connected.
        </AgentText>
      )}
    </AgentSheet>
  );
}
