import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function AgentWorkingIndicator({
  label = "Agent working",
}: {
  label?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <ActivityIndicator
        accessibilityLabel={label}
        accessibilityRole="progressbar"
        size="small"
        color={colors.foreground}
        style={{ transform: [{ scale: 0.75 }] }}
      />
    </View>
  );
}
