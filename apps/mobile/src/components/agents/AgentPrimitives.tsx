import { ErrorNotice } from "@/components/ErrorNotice";
import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetFooterProps,
} from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
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

/** Compact transcript action. The hit slop keeps the touch target at 44pt. */
export function AgentIconButton({
  label,
  icon,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      ) : (
        <Ionicons name={icon} size={16} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

/** An inline status above the composer, with optional actions. */
export function AgentNotice({
  icon = "information-circle-outline",
  warning = false,
  message,
  actions = [],
  onDismiss,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  warning?: boolean;
  message: string;
  actions?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    primary?: boolean;
  }[];
  onDismiss?: () => void;
}) {
  const { colors, fonts, radii, scheme } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingLeft: 12,
        paddingRight: onDismiss ? 8 : 12,
        paddingVertical: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors.muted,
        borderRadius: radii.xl,
      }}
    >
      <Ionicons
        name={icon}
        size={18}
        color={
          warning
            ? scheme === "dark"
              ? "#e1a447"
              : "#a36500"
            : colors.mutedForeground
        }
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 6 }}>
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansRegular,
            fontSize: 14,
            lineHeight: 20,
          }}
        >
          {message}
        </Text>
        {actions.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {actions.map((action) => (
              <Pressable
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityState={{ disabled: !!action.disabled }}
                disabled={action.disabled}
                onPress={action.onPress}
                // Compact pills keep a 44pt touch target.
                hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                style={({ pressed }) => ({
                  minHeight: 32,
                  justifyContent: "center",
                  paddingHorizontal: 12,
                  borderRadius: radii.pill,
                  borderWidth: action.primary ? 0 : StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                  backgroundColor: action.primary ? colors.primary : colors.background,
                  opacity: action.disabled ? 0.45 : pressed ? 0.8 : 1,
                })}
              >
                <Text
                  style={{
                    color: action.primary ? colors.primaryForeground : colors.foreground,
                    fontFamily: fonts.sansMedium,
                    fontSize: 13,
                  }}
                >
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={10}
          onPress={onDismiss}
          style={{ padding: 2 }}
        >
          <Ionicons name="close" size={18} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
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
      {!!error && <ErrorNotice message={error} action={retry ? { label: "Retry", onPress: retry } : undefined} />}
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
  const [footerHeight, setFooterHeight] = useState(0);
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
  // The sheet lays out at its tallest snap point; a sheet footer stays on the
  // visible edge at every height, so actions are never pushed off screen.
  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>
        <View
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: insets.bottom + 16,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          {footer}
        </View>
      </BottomSheetFooter>
    ),
    [footer, insets.bottom, colors.border, colors.card],
  );
  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      footerComponent={footer ? renderFooter : undefined}
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
          paddingBottom: footer ? footerHeight + 16 : insets.bottom + 24,
          gap: 10,
        }}
      >
        {children}
      </BottomSheetScrollView>
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
