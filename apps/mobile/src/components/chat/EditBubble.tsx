import { useEffect, useRef, useState } from "react";
import type { FileUIPart } from "ai";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { AttachmentChip } from "./AttachmentChip";

export function EditBubble({
  initialText,
  initialFiles,
  onSave,
  onCancel,
}: {
  initialText: string;
  initialFiles: FileUIPart[];
  onSave: (text: string, files: FileUIPart[]) => void;
  onCancel: () => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const [draft, setDraft] = useState(initialText);
  const [files, setFiles] = useState(initialFiles);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const nextText = draft.trim();
  const dirty =
    nextText !== initialText.trim() || files.length !== initialFiles.length;
  const canSend = dirty && (nextText.length > 0 || files.length > 0);

  function send() {
    if (!canSend) return;
    onSave(nextText, files);
  }

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.xxl,
          },
        ]}
      >
        {files.length > 0 ? (
          <View style={styles.attachments}>
            {files.map((file, i) => (
              <AttachmentChip
                key={`${file.url}-${i}`}
                attachment={file}
                onRemove={() =>
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }
              />
            ))}
          </View>
        ) : null}
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={setDraft}
          multiline
          accessibilityLabel="Edit message"
          textAlignVertical="top"
          style={[
            styles.input,
            { color: colors.cardForeground, fontFamily: fonts.sansRegular },
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
            onPress={send}
            disabled={!canSend}
            hitSlop={6}
            style={[
              styles.btn,
              styles.saveBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: radii.pill,
                opacity: canSend ? 1 : 0.5,
              },
            ]}
          >
            <Text
              style={[
                styles.btnText,
                { color: colors.primaryForeground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              Send
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
    maxWidth: "92%",
    minWidth: 260,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attachments: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    marginBottom: 10,
  },
  input: {
    fontSize: 15,
    lineHeight: 22,
    minHeight: 80,
    maxHeight: 240,
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
