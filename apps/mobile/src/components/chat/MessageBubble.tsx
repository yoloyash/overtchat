import type { UIMessage } from "ai";
import { StyleSheet, Text, View } from "react-native";
import { textOf } from "@/lib/chat/text";
import { useTheme } from "@/lib/theme";

export function MessageBubble({
  message,
  streaming,
}: {
  message: UIMessage;
  streaming: boolean;
}) {
  const { colors, radii, fonts } = useTheme();
  const text = textOf(message);

  if (message.role === "user") {
    if (!text) return null;
    return (
      <View style={styles.userRow}>
        <View
          style={[
            styles.userBubble,
            { backgroundColor: colors.secondary, borderRadius: radii.xxl },
          ]}
        >
          <Text
            style={[
              styles.text,
              { color: colors.secondaryForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <Text
        style={[
          styles.assistantText,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {text}
        {streaming && <Text style={{ color: colors.mutedForeground }}>▍</Text>}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: { alignItems: "flex-end" },
  assistantRow: { alignItems: "flex-start" },
  userBubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  text: { fontSize: 15, lineHeight: 22 },
  assistantText: { fontSize: 16, lineHeight: 24 },
});
