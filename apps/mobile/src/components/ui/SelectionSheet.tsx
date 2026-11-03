import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { BackHandler, Keyboard, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

/** A single-choice picker using the same sheet presentation as the drawer. */
export function SelectionSheet<T extends string>({
  title,
  visible,
  value,
  options,
  disabled,
  onClose,
  onSelect,
}: {
  title: string;
  visible: boolean;
  value: T;
  options: readonly { value: T; label: string; leading?: ReactNode }[];
  disabled?: boolean;
  onClose: () => void;
  onSelect: (value: T) => void;
}) {
  const ref = useRef<BottomSheetModal>(null);
  const presented = useRef(false);
  const [search, setSearch] = useState("");
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const searchable = options.length > 8;
  useEffect(() => {
    if (visible && !presented.current) {
      Keyboard.dismiss();
      setSearch("");
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
  const filtered = options.filter(
    (option) =>
      !searchable || option.label.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={searchable ? ["75%"] : undefined}
      enableDynamicSizing={!searchable}
      topInset={insets.top}
      enablePanDownToClose
      onDismiss={() => {
        presented.current = false;
        onClose();
      }}
      backdropComponent={backdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 16,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            marginBottom: 8,
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              flex: 1,
              fontFamily: fonts.serifSemiBold,
              fontSize: 20,
              color: colors.popoverForeground,
            }}
          >
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
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
        </View>
        {searchable && (
          <BottomSheetTextInput
            accessibilityLabel={`Search ${title.toLowerCase()}`}
            placeholder="Search"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="none"
            style={{
              minHeight: 48,
              borderRadius: radii.md,
              backgroundColor: colors.muted,
              paddingHorizontal: 12,
              marginBottom: 8,
              color: colors.foreground,
              fontFamily: fonts.sansRegular,
              fontSize: 16,
            }}
          />
        )}
        {filtered.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{
              checked: value === option.value,
              disabled: !!disabled,
            }}
            disabled={disabled}
            onPress={() => {
              if (!presented.current) return;
              presented.current = false;
              ref.current?.dismiss();
              if (option.value !== value) onSelect(option.value);
            }}
            style={({ pressed }) => ({
              minHeight: 52,
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              borderRadius: radii.md,
              backgroundColor:
                pressed || value === option.value
                  ? colors.accent
                  : "transparent",
              opacity: disabled ? 0.5 : 1,
            })}
          >
            {option.leading && (
              <View
                accessible={false}
                style={{ width: 28, alignItems: "center" }}
              >
                {option.leading}
              </View>
            )}
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.sansRegular,
                fontSize: 16,
                color: colors.foreground,
              }}
            >
              {option.label}
            </Text>
            {value === option.value && (
              <Ionicons name="checkmark" size={20} color={colors.foreground} />
            )}
          </Pressable>
        ))}
        {!filtered.length && (
          <Text
            style={{
              padding: 16,
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
            }}
          >
            No matching options
          </Text>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
