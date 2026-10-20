import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { getErrorMessage } from "@overtchat/shared";
import { useTheme } from "@/lib/theme";

export function ErrorNotice({
  message,
  fallback,
  onDismiss,
  action,
}: {
  // Strings are display copy supplied by the caller; exceptions are normalized.
  message: unknown;
  fallback?: string;
  onDismiss?: () => void;
  action?: { label: string; onPress: () => void };
}) {
  const { colors, fonts, radii } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.muted,
        borderRadius: radii.md,
      }}
    >
      <Ionicons
        name="alert-circle-outline"
        size={18}
        color={colors.destructive}
        accessible={false}
      />
      <View style={{ flex: 1, gap: 8 }}>
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansRegular,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {typeof message === "string" ? message : getErrorMessage(message, fallback)}
        </Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            onPress={action.onPress}
            style={{
              alignSelf: "flex-start",
              paddingVertical: 8,
              paddingHorizontal: 4,
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: fonts.sansMedium,
                fontSize: 13,
              }}
            >
              {action.label}
            </Text>
          </Pressable>
        )}
      </View>
      {onDismiss && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss error"
          onPress={onDismiss}
          hitSlop={10}
          style={{ padding: 4 }}
        >
          <Ionicons name="close" size={18} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}
