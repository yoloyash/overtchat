import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import type { SpeechStatus } from "@/lib/useSpeech";
import { useTheme } from "@/lib/theme";

export function MessageActions({
  onCopy,
  onRegenerate,
  onSpeak,
  copied,
  speechStatus = "idle",
}: {
  onCopy: () => void;
  onRegenerate?: () => void;
  onSpeak?: () => void;
  copied: boolean;
  speechStatus?: SpeechStatus;
}) {
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <IconButton
        icon={copied ? "check" : "copy"}
        onPress={onCopy}
        color={colors.mutedForeground}
        accessibilityLabel={copied ? "Copied" : "Copy message"}
      />
      {onRegenerate ? (
        <IconButton
          icon="rotate-ccw"
          onPress={onRegenerate}
          color={colors.mutedForeground}
          accessibilityLabel="Regenerate response"
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
              ? "Stop reading"
              : speechStatus === "loading"
                ? "Loading speech"
                : "Read aloud"
          }
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
