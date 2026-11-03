import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type RenameSheetRef = BottomSheetModal;

/** Bottom sheet with one text field, for renaming a chat or an agent session. */
export const RenameSheet = forwardRef<
  RenameSheetRef,
  {
    /** The record being renamed; the sheet does nothing without one. */
    targetId: string | null;
    initialTitle: string | null;
    heading: string;
    placeholder: string;
    maxLength?: number;
    onSubmit: (id: string, title: string) => void;
  }
>(function RenameSheet(
  { targetId, initialTitle, heading, placeholder, maxLength = 200, onSubmit },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const [draft, setDraft] = useState(initialTitle ?? "");

  useEffect(() => {
    setDraft(initialTitle ?? "");
  }, [initialTitle, targetId]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const trimmed = draft.trim();
  const initialTrim = (initialTitle ?? "").trim();
  const canSave = trimmed.length > 0 && trimmed !== initialTrim;

  function dismiss() {
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
  }

  function save() {
    if (!canSave || !targetId) return;
    onSubmit(targetId, trimmed);
    dismiss();
  }

  const bottomPadding =
    keyboardHeight > 0 ? keyboardHeight + 16 : 16 + insets.bottom;

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetView style={[styles.body, { paddingBottom: bottomPadding }]}>
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          {heading}
        </Text>

        <BottomSheetTextInput
          accessibilityLabel={placeholder}
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          maxLength={maxLength}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.muted,
              borderRadius: radii.md,
              fontFamily: fonts.sansRegular,
            },
          ]}
        />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={dismiss}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: "transparent",
                borderColor: colors.border,
                borderRadius: radii.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: colors.foreground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save"
            disabled={!canSave}
            onPress={save}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                borderColor: "transparent",
                borderRadius: radii.md,
                opacity: !canSave ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                {
                  color: colors.primaryForeground,
                  fontFamily: fonts.sansSemiBold,
                },
              ]}
            >
              Save
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 88,
    alignItems: "center",
  },
  buttonText: { fontSize: 14 },
});
