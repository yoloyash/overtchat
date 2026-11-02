import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect } from "expo-router";
import {
  usePreventRemove,
  useNavigation,
  useHeaderHeight,
} from "expo-router/react-navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";
import { getServerUrl } from "@/lib/server-url";
import { toastError } from "@/lib/toast";
import { SelectionSheet } from "@/components/ui/SelectionSheet";

export function SettingsPage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    disabled?: boolean;
  };
}) {
  const { colors, fonts } = useTheme();
  const headerHeight = useHeaderHeight();
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerBackTitle: "Back",
          headerTitleStyle: { fontFamily: fonts.serifSemiBold },
          headerShadowVisible: false,
          headerRight: action
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  accessibilityState={{ disabled: !!action.disabled }}
                  disabled={action.disabled}
                  onPress={action.onPress}
                  style={({ pressed }) => ({
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed || action.disabled ? 0.5 : 1,
                  })}
                >
                  <Ionicons
                    name={action.icon}
                    size={24}
                    color={colors.foreground}
                  />
                </Pressable>
              )
            : undefined,
        }}
      />
      <SafeAreaView
        edges={["bottom", "left", "right"]}
        style={{ flex: 1, backgroundColor: colors.background }}
      >
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={headerHeight}
          style={{ flex: 1 }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.page}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </>
  );
}
export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  const { colors, radii } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {title && <Label muted>{title.toUpperCase()}</Label>}
      <View
        style={{
          borderRadius: radii.lg,
          backgroundColor: colors.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {description && <Label muted>{description}</Label>}
    </View>
  );
}
export function Label({
  children,
  muted = false,
  error = false,
}: {
  children: ReactNode;
  muted?: boolean;
  error?: boolean;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Text
      accessibilityRole={error ? "alert" : undefined}
      style={{
        color: error
          ? colors.destructive
          : muted
            ? colors.mutedForeground
            : colors.foreground,
        fontFamily: fonts.sansRegular,
        fontSize: muted ? 12 : 15,
        lineHeight: muted ? 18 : 22,
      }}
    >
      {children}
    </Text>
  );
}
export function Row({
  title,
  detail,
  value,
  onPress,
  icon,
  leading,
  navigation = false,
  expanded,
  status,
  external,
  destructive,
  disabled,
  children,
}: {
  title: string;
  detail?: string;
  value?: string;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  leading?: ReactNode;
  navigation?: boolean;
  expanded?: boolean;
  status?: ReactNode;
  external?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { colors, fonts } = useTheme();
  const body = (
    <>
      {leading ? (
        <View accessible={false} style={{ minWidth: 28, alignItems: "center" }}>
          {leading}
        </View>
      ) : (
        icon && (
          <View style={{ width: 28, alignItems: "center" }}>
            <Ionicons
              name={icon}
              size={21}
              color={destructive ? colors.destructive : colors.mutedForeground}
            />
          </View>
        )
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          style={{
            color: destructive ? colors.destructive : colors.foreground,
            fontFamily: fonts.sansRegular,
            fontSize: 16,
          }}
        >
          {title}
        </Text>
        {detail && <Label muted>{detail}</Label>}
        {status}
      </View>
      {value && (
        <Text
          numberOfLines={1}
          style={{
            maxWidth: "42%",
            color: colors.mutedForeground,
            fontFamily: fonts.sansRegular,
            fontSize: 13,
          }}
        >
          {value}
        </Text>
      )}
      {children}
      {onPress && (navigation || external || expanded !== undefined) && (
        <Ionicons
          name={
            external
              ? "open-outline"
              : expanded !== undefined
                ? expanded
                  ? "chevron-up"
                  : "chevron-down"
                : "chevron-forward"
          }
          size={17}
          color={colors.mutedForeground}
        />
      )}
    </>
  );
  const style = [
    styles.row,
    { borderBottomColor: colors.border, opacity: disabled ? 0.5 : 1 },
  ];
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityState={{
        disabled: !!disabled,
        ...(expanded !== undefined ? { expanded } : {}),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        ...style,
        { backgroundColor: pressed ? colors.muted : undefined },
      ]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}
export function Toggle({
  title,
  detail,
  value,
  onChange,
  disabled,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Row title={title} detail={detail}>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primary }}
        accessibilityState={{ disabled: !!disabled, checked: value }}
      />
    </Row>
  );
}
export function Choice<T extends string>({
  title,
  value,
  options,
  onChange,
  disabled,
}: {
  title: string;
  value: T;
  options: readonly { value: T; label: string; leading?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        title={title}
        value={options.find((o) => o.value === value)?.label ?? value}
        leading={options.find((o) => o.value === value)?.leading}
        navigation
        onPress={() => setOpen(true)}
        disabled={disabled}
      />
      <SelectionSheet
        title={title}
        visible={open}
        value={value}
        options={options}
        disabled={disabled}
        onClose={() => setOpen(false)}
        onSelect={onChange}
      />
    </>
  );
}
export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View style={{ padding: 14, gap: 7 }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        autoCorrect={false}
        autoCapitalize="none"
        {...props}
        style={[
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.md,
            fontFamily: fonts.sansRegular,
            fontSize: 16,
            padding: 12,
            minHeight: props.multiline ? 110 : 48,
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.style,
        ]}
      />
      {hint && <Label muted>{hint}</Label>}
    </View>
  );
}
export function SearchField({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 12,
        paddingRight: 4,
        minHeight: 48,
        borderRadius: radii.md,
        backgroundColor: colors.muted,
      }}
    >
      <Ionicons
        name="search-outline"
        size={19}
        color={colors.mutedForeground}
      />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 48,
          fontFamily: fonts.sansRegular,
          fontSize: 16,
          color: colors.foreground,
        }}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name="close-circle"
            size={19}
            color={colors.mutedForeground}
          />
        </Pressable>
      )}
    </View>
  );
}
export function Action({
  title,
  onPress,
  disabled,
  destructive,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  secondary?: boolean;
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 15,
        minHeight: 48,
        borderRadius: radii.lg,
        alignItems: "center",
        backgroundColor: secondary
          ? colors.muted
          : destructive
            ? colors.destructive
            : colors.primary,
        opacity: pressed || disabled ? 0.55 : 1,
      })}
    >
      <Text
        style={{
          color: secondary ? colors.foreground : colors.primaryForeground,
          fontFamily: fonts.sansSemiBold,
          fontSize: 15,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function QueryState({
  query,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
}) {
  const { colors } = useTheme();
  return query.isPending ? (
    <ActivityIndicator color={colors.primary} />
  ) : query.error ? (
    <>
      <Label error>{query.error.message}</Label>
      <Action secondary title="Retry" onPress={() => void query.refetch()} />
    </>
  ) : null;
}
export function useRefreshOnFocus(refetch: () => unknown) {
  useFocusEffect(
    useCallback(() => {
      void refetch();
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refetch();
      });
      return () => subscription.remove();
    }, [refetch]),
  );
}
export function useUnsavedChanges(dirty: boolean) {
  const navigation = useNavigation();
  usePreventRemove(dirty, ({ data }) => {
    Alert.alert("Discard changes?", "Your changes haven’t been saved.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t complete the request.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run };
}
export function WebRow({
  title,
  path,
  detail,
}: {
  title: string;
  path: string;
  detail?: string;
}) {
  return (
    <Row
      title={title}
      detail={detail ?? "Open in browser"}
      external
      onPress={() => void openSettingsOnWeb(path)}
    />
  );
}
export async function openSettingsOnWeb(path: string) {
  const server = getServerUrl();
  if (!server) return;
  try {
    await Linking.openURL(`${server.replace(/\/$/, "")}${path}`);
  } catch (error) {
    toastError("Couldn’t open browser", error);
  }
}
const styles = StyleSheet.create({
  page: { padding: 16, gap: 24, paddingBottom: 40 },
  row: {
    minHeight: 54,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
