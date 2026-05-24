import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function Composer({
  configured,
  streaming,
  onSubmit,
  onStop,
}: {
  configured: boolean;
  streaming: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [input, setInput] = useState("");

  function submit() {
    const text = input.trim();
    if (!text || streaming || !configured) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSubmit(text);
    setInput("");
  }

  const canSend = input.trim().length > 0 && !streaming && configured;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radii.pill,
        },
      ]}
    >
      <TextInput
        value={input}
        onChangeText={setInput}
        editable={configured}
        multiline
        placeholder={
          configured ? "Message…" : "No models available — ask an admin to add one"
        }
        placeholderTextColor={colors.mutedForeground}
        style={[
          styles.input,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      />
      {streaming ? (
        <Pressable
          accessibilityRole="button"
          onPress={onStop}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: colors.secondary,
              borderRadius: radii.pill,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="stop" size={16} color={colors.secondaryForeground} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={!canSend}
          onPress={submit}
          style={({ pressed }) => [
            styles.send,
            {
              backgroundColor: colors.primary,
              borderRadius: radii.pill,
              opacity: !canSend ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="arrow-up" size={20} color={colors.primaryForeground} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 140,
    fontSize: 16,
    paddingVertical: 8,
  },
  send: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
