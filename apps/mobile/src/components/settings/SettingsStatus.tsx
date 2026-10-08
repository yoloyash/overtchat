import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function SettingsStatus({
  label,
  state = "neutral",
}: {
  label: string;
  state?: "ready" | "attention" | "neutral";
}) {
  const { colors, fonts } = useTheme();
  const color = state === "ready" ? colors.primary : colors.mutedForeground;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <Ionicons
        name={
          state === "ready"
            ? "checkmark-circle-outline"
            : state === "attention"
              ? "alert-circle-outline"
              : "ellipse-outline"
        }
        size={14}
        color={color}
      />
      <Text
        style={{
          fontFamily: fonts.sansRegular,
          fontSize: 12,
          color,
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
