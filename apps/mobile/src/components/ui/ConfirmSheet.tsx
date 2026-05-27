import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type ConfirmSheetRef = BottomSheetModal;

export const ConfirmSheet = forwardRef<
  ConfirmSheetRef,
  {
    title: string;
    message?: string;
    confirmLabel: string;
    cancelLabel?: string;
    destructive?: boolean;
    onConfirm: () => void;
  }
>(function ConfirmSheet(
  {
    title,
    message,
    confirmLabel,
    cancelLabel = "Cancel",
    destructive = false,
    onConfirm,
  },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();

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

  function dismiss() {
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
  }

  function confirm() {
    onConfirm();
    dismiss();
  }

  const confirmBg = destructive ? colors.destructive : colors.primary;
  const confirmFg = destructive ? "#ffffff" : colors.primaryForeground;

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
      <BottomSheetView
        style={[styles.body, { paddingBottom: 16 + insets.bottom }]}
      >
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          {title}
        </Text>
        {message ? (
          <Text
            style={[
              styles.message,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {message}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
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
              {cancelLabel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            onPress={confirm}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: confirmBg,
                borderColor: "transparent",
                borderRadius: radii.md,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: confirmFg, fontFamily: fonts.sansSemiBold },
              ]}
            >
              {confirmLabel}
            </Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  title: { fontSize: 18 },
  message: { fontSize: 14, lineHeight: 20 },
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 12,
  },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 96,
    alignItems: "center",
  },
  buttonText: { fontSize: 14 },
});
