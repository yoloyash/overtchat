import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, BackHandler, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";
import { Ionicons } from "@expo/vector-icons";

export function AgentText({
  children,
  muted = false,
  danger = false,
  title = false,
}: {
  children: ReactNode;
  muted?: boolean;
  danger?: boolean;
  title?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      selectable
      style={{
        color: danger
          ? colors.destructive
          : muted
            ? colors.mutedForeground
            : colors.foreground,
        fontFamily: title ? fonts.sansSemiBold : fonts.sansRegular,
        fontSize: title ? 17 : 14,
        lineHeight: title ? 24 : 21,
      }}
    >
      {children}
    </Text>
  );
}

export function AgentButton({
  label,
  onPress,
  disabled,
  selected,
  danger,
  detail,
  testID,
  icon,
  leading,
  chevron,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  danger?: boolean;
  detail?: string;
  testID?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  leading?: ReactNode;
  chevron?: boolean;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: radii.md,
        backgroundColor: selected
          ? colors.accent
          : pressed
            ? colors.muted
            : "transparent",
        opacity: disabled ? 0.45 : 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
      })}
    >
      {leading ??
        (icon ? (
          <Ionicons
            name={icon}
            size={19}
            color={danger ? colors.destructive : colors.mutedForeground}
          />
        ) : null)}
      <View
        style={{
          flexShrink: 1,
          flexGrow: detail || chevron ? 1 : 0,
          minWidth: 0,
        }}
      >
        <Text
          style={{
            color: danger ? colors.destructive : colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 14,
          }}
        >
          {label}
        </Text>
        {!!detail && (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {detail}
          </Text>
        )}
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={18} color={colors.foreground} />
      ) : chevron ? (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colors.mutedForeground}
        />
      ) : null}
    </Pressable>
  );
}

export function AgentFeedback({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string | null;
  retry?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: 16, gap: 8 }}>
      {loading && <ActivityIndicator color={colors.mutedForeground} />}
      {!!error && <AgentText danger>{error}</AgentText>}
      {!!error && retry && <AgentButton label="Retry" onPress={retry} />}
    </View>
  );
}

export function AgentSheet({
  title,
  visible,
  onClose,
  children,
  footer,
  closeLabel = "Done",
  snapPoints = ["80%"],
}: {
  title: string;
  footer?: ReactNode;
  closeLabel?: string;
  snapPoints?: string[];
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const presented = useRef(false);
  const { colors, radii } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible && !presented.current) {
      presented.current = true;
      ref.current?.present();
    } else if (!visible && presented.current) {
      presented.current = false;
      ref.current?.dismiss();
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      ref.current?.dismiss();
      return true;
    });
    return () => listener.remove();
  }, [visible]);
  const backdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );
  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      topInset={insets.top}
      enablePanDownToClose
      onDismiss={() => {
        // Dismissing an unmounted sheet leaves Gorhom's portal in DISMISSING
        // state. Do not dismiss again when onClose sets visible to false.
        presented.current = false;
        onClose();
      }}
      backdropComponent={backdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backgroundStyle={{ backgroundColor: colors.card, borderRadius: radii.xl }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ flex: 1 }}>
          <AgentText title>{title}</AgentText>
        </View>
        {closeLabel === "Done" ? (
          <AgentButton label="Done" onPress={() => ref.current?.dismiss()} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={() => ref.current?.dismiss()}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={22} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>
      <BottomSheetScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: footer ? 16 : insets.bottom + 24,
          gap: 10,
        }}
      >
        {children}
      </BottomSheetScrollView>
      {footer && (
        <View
          style={{
            flexShrink: 0,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            borderTopWidth: 1,
            borderColor: colors.border,
          }}
        >
          {footer}
        </View>
      )}
    </BottomSheetModal>
  );
}

export function AgentInput(
  props: React.ComponentProps<typeof BottomSheetTextInput>,
) {
  const { colors, radii, fonts } = useTheme();
  return (
    <BottomSheetTextInput
      placeholderTextColor={colors.mutedForeground}
      {...props}
      style={[
        {
          minHeight: 46,
          padding: 12,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radii.md,
          color: colors.foreground,
          fontFamily: fonts.sansRegular,
          fontSize: 16,
        },
        props.style,
      ]}
    />
  );
}
