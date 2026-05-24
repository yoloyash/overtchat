import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function Composer({
  configured,
  streaming,
  searchEnabled,
  onToggleSearch,
  onSubmit,
  onStop,
}: {
  configured: boolean;
  streaming: boolean;
  searchEnabled: boolean;
  onToggleSearch: () => void;
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

  function toggleSearch() {
    Haptics.selectionAsync().catch(() => {});
    onToggleSearch();
  }

  const canSend = input.trim().length > 0 && !streaming && configured;

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radii.xxl,
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
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: searchEnabled }}
          accessibilityLabel={searchEnabled ? "Disable web search" : "Enable web search"}
          onPress={toggleSearch}
          style={({ pressed }) => [
            styles.searchToggle,
            {
              backgroundColor: searchEnabled ? colors.accent : "transparent",
              borderColor: searchEnabled ? colors.accent : colors.border,
              borderRadius: radii.pill,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons
            name="globe-outline"
            size={14}
            color={searchEnabled ? colors.foreground : colors.mutedForeground}
          />
          <Text
            style={[
              styles.searchLabel,
              {
                color: searchEnabled ? colors.foreground : colors.mutedForeground,
                fontFamily: fonts.sansMedium,
              },
            ]}
          >
            Search
          </Text>
        </Pressable>
        <View style={styles.spacer} />
        {streaming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop generating"
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
            accessibilityLabel="Send message"
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
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "column",
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minHeight: 28,
    maxHeight: 140,
    fontSize: 16,
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchLabel: {
    fontSize: 12,
  },
  spacer: { flex: 1 },
  send: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
