import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const values = contextValues(usage);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        values?.percentage !== undefined
          ? t("agents.mobile.contextUsage.triggerPercent", {
              percentage: values.percentage,
            })
          : t("agents.mobile.contextUsage.triggerUnavailable")
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
  const { t } = useTranslation();
  const { colors, fonts } = useTheme();
  const values = contextValues(usage);
  const limit =
    usage && Number.isFinite(usage.contextWindow) && usage.contextWindow > 0
      ? usage.contextWindow
      : undefined;
  const rows = [
    ["used", t("agents.mobile.contextUsage.used"), values?.usedTokens],
    ["remaining", t("agents.mobile.contextUsage.remaining"), values?.remainingTokens],
    ["window", t("agents.mobile.contextUsage.contextWindow"), limit],
  ] as const;
  return (
    <AgentSheet
      title={t("agents.mobile.contextUsage.title")}
      visible={visible}
      onClose={onClose}
      closeLabel={t("agents.mobile.contextUsage.closeLabel")}
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
            ? t("agents.mobile.contextUsage.percentUsed", { percentage: values.percentage })
            : t("agents.mobile.contextUsage.unavailable")}
        </AgentText>
      </View>
      <View style={{ gap: 16 }}>
        {rows.map(([key, label, value]) => (
          <View
            key={key}
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
                : t("agents.context.tokensUsed", {
                    used: Math.round(value).toLocaleString(),
                  })}
            </Text>
          </View>
        ))}
      </View>
      {values?.percentage === undefined && (
        <AgentText muted>
          {values
            ? t("agents.mobile.contextUsage.noLimit")
            : t("agents.mobile.contextUsage.notReported")}
        </AgentText>
      )}
      {stale && (
        <AgentText muted>
          {t("agents.mobile.contextUsage.stale")}
        </AgentText>
      )}
    </AgentSheet>
  );
}
