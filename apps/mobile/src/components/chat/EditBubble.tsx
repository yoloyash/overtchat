import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function EditBubble({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [draft, setDraft] = useState(initialText);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const dirty = draft.trim().length > 0 && draft !== initialText;

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.secondary,
            borderRadius: radii.xxl,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            { color: colors.secondaryForeground, fontFamily: fonts.sansRegular },
          ]}
        />
        <View style={styles.actions}>
          <Pressable onPress={onCancel} hitSlop={6} style={styles.btn}>
            <Text
              style={[
                styles.btnText,
                { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onSave(draft.trim())}
            disabled={!dirty}
            hitSlop={6}
            style={[
              styles.btn,
              styles.saveBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: radii.pill,
                opacity: dirty ? 1 : 0.5,
              },
            ]}
          >
            <Text
              style={[
                styles.btnText,
                { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "flex-end" },
  bubble: {
    maxWidth: "85%",
    minWidth: 220,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: 22,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  btn: { paddingHorizontal: 4, paddingVertical: 4 },
  saveBtn: { paddingHorizontal: 14 },
  btnText: { fontSize: 13 },
});
