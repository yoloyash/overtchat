import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function Composer({
  configured,
  streaming,
  searchEnabled,
  onDisableSearch,
  onOpenAddSheet,
  onSubmit,
  onStop,
}: {
  configured: boolean;
  streaming: boolean;
  searchEnabled: boolean;
  onDisableSearch: () => void;
  onOpenAddSheet: () => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const [input, setInput] = useState("");

  function submit() {
    const text = input.trim();
    if (!text || streaming || !configured) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { });
    onSubmit(text);
    setInput("");
  }

  function openAdd() {
    Haptics.selectionAsync().catch(() => { });
    onOpenAddSheet();
  }

  function disableSearch() {
    Haptics.selectionAsync().catch(() => { });
    onDisableSearch();
  }

  const canSend = input.trim().length > 0 && !streaming && configured;
  const showPillsRow = searchEnabled;

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
      {showPillsRow && (
        <View style={styles.pillsRow}>
          {searchEnabled && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Disable web search"
              onPress={disableSearch}
              style={({ pressed }) => [
                styles.pill,
                {
                  backgroundColor: colors.accent,
                  borderRadius: radii.pill,
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <Ionicons
                name="globe-outline"
                size={14}
                color={colors.foreground}
              />
              <Text
                style={[
                  styles.pillLabel,
                  { color: colors.foreground, fontFamily: fonts.sansMedium },
                ]}
              >
                Search
              </Text>
              <Ionicons name="close" size={14} color={colors.foreground} />
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.inputRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add to chat"
          onPress={openAdd}
          style={({ pressed }) => [
            styles.iconButton,
            {
              backgroundColor: "transparent",
              borderColor: colors.border,
              borderRadius: radii.pill,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name="add" size={20} color={colors.mutedForeground} />
        </Pressable>

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
            accessibilityLabel="Stop generating"
            onPress={onStop}
            style={({ pressed }) => [
              styles.iconButton,
              {
                backgroundColor: colors.secondary,
                borderRadius: radii.pill,
                borderColor: "transparent",
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
              styles.iconButton,
              {
                backgroundColor: colors.primary,
                borderRadius: radii.pill,
                borderColor: "transparent",
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
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  pillsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 9,
    paddingRight: 7,
    paddingVertical: 5,
  },
  pillLabel: { fontSize: 14 },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  iconButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 162,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
  },
});
