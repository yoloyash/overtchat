import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type CreateProjectSheetRef = BottomSheetModal;

export const CreateProjectSheet = forwardRef<
  CreateProjectSheetRef,
  {
    submitting: boolean;
    onSubmit: (name: string) => void;
  }
>(function CreateProjectSheet({ submitting, onSubmit }, ref) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardState((s) => (s.isVisible ? s.height : 0));
  const [name, setName] = useState("");

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

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  function dismiss() {
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  const bottomPadding =
    keyboardHeight > 0 ? keyboardHeight + 16 : 16 + insets.bottom;

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      onDismiss={() => setName("")}
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
          New project
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          Give it a name. You can add instructions after creating it.
        </Text>

        <BottomSheetTextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Work — weekly review"
          placeholderTextColor={colors.mutedForeground}
          maxLength={120}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
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
            accessibilityLabel="Create"
            disabled={!canSubmit}
            onPress={submit}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                borderColor: "transparent",
                borderRadius: radii.md,
                opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  {
                    color: colors.primaryForeground,
                    fontFamily: fonts.sansSemiBold,
                  },
                ]}
              >
                Create
              </Text>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  subtitle: { fontSize: 13, paddingHorizontal: 4 },
  input: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
    marginTop: 6,
  },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 4 },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 88,
    alignItems: "center",
  },
  buttonText: { fontSize: 14 },
});
