import { Feather } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import type { SpeechStatus } from "@/lib/useSpeech";
import { useTheme } from "@/lib/theme";

export function MessageActions({
  onCopy,
  onRegenerate,
  onContinue,
  onSpeak,
  copied,
  speechStatus = "idle",
}: {
  onCopy: () => void;
  onRegenerate?: () => void;
  onContinue?: () => void;
  onSpeak?: () => void;
  copied: boolean;
  speechStatus?: SpeechStatus;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.row}>
      <IconButton
        icon={copied ? "check" : "copy"}
        onPress={onCopy}
        color={colors.mutedForeground}
        accessibilityLabel={copied ? t("common.states.copied") : t("chat.mobile.messages.copyMessage")}
      />
      {onRegenerate ? (
        <IconButton
          icon="rotate-ccw"
          onPress={onRegenerate}
          color={colors.mutedForeground}
          accessibilityLabel={t("chat.mobile.messages.regenerateResponse")}
        />
      ) : null}
      {onSpeak ? (
        <IconButton
          icon={
            speechStatus === "playing" || speechStatus === "paused"
              ? "square"
              : speechStatus === "loading"
                ? "loader"
                : "volume-2"
          }
          onPress={onSpeak}
          color={colors.mutedForeground}
          accessibilityLabel={
            speechStatus === "playing" || speechStatus === "paused"
              ? t("chat.mobile.messages.stopReading")
              : speechStatus === "loading"
                ? t("chat.mobile.messages.loadingSpeech")
                : t("chat.mobile.messages.readAloud")
          }
        />
      ) : null}
      {onContinue ? (
        <IconButton
          icon="play"
          onPress={onContinue}
          color={colors.mutedForeground}
          accessibilityLabel={t("chat.messages.continueResponse")}
        />
      ) : null}
    </View>
  );
}

function IconButton({
  icon,
  onPress,
  color,
  accessibilityLabel,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  color: string;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.5 : 1 }]}
    >
      <Feather name={icon} size={16} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 4, marginTop: 6 },
  btn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
