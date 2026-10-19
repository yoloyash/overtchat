import { Ionicons } from "@expo/vector-icons";
import {
  normalizeOpenUILang,
  type OpenUIToolPart,
} from "@overtchat/shared";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { CodeBlock } from "./CodeBlock";

export function OpenUICard({
  part,
  streaming,
}: {
  part: OpenUIToolPart;
  streaming: boolean;
}) {
  const { colors, fonts } = useTheme();
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const isStreaming = streaming && pending;
  const code = normalizeOpenUILang(part.input?.ui ?? part.rawInput?.ui);

  return (
    <View style={styles.container}>
      <View style={styles.statusRow} accessibilityRole="text">
        {isStreaming ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : (
          <Ionicons
            name="grid-outline"
            size={15}
            color={colors.mutedForeground}
          />
        )}
        <Text
          style={[
            styles.statusText,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {isStreaming
            ? "Building interactive UI…"
            : part.state === "output-error"
              ? "Interactive UI failed"
              : "Interactive UI"}
        </Text>
      </View>
      {part.state === "output-error" ? (
        <Text
          style={[
            styles.errorText,
            { color: colors.destructive, fontFamily: fonts.sansRegular },
          ]}
        >
          {part.errorText ?? "The interactive UI could not be rendered."}
        </Text>
      ) : null}
      {code.trim().length > 0 ? (
        <CodeBlock code={code} language="openui" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    width: "100%",
    gap: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusText: {
    fontSize: 13,
  },
  errorText: {
    fontSize: 13,
  },
});
