import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import type { approvalDetails } from "@/lib/agents/tool-details";

export function AgentApprovalActions({
  choices,
  disabled,
  onChoose,
}: {
  choices: ReturnType<typeof approvalDetails>["choices"];
  disabled: boolean;
  onChoose: (value: string) => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {choices.map((choice) => {
        const primary = choice.kind === "allow";
        return (
          <Pressable
            key={choice.value}
            accessibilityRole="button"
            accessibilityLabel={choice.label}
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onChoose(choice.value)}
            style={({ pressed }) => ({
              minHeight: 46,
              borderRadius: 12,
              borderWidth: primary ? 0 : 1,
              borderColor: colors.border,
              backgroundColor: primary
                ? colors.primary
                : pressed
                  ? colors.muted
                  : "transparent",
              opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
              paddingHorizontal: 14,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            })}
          >
            <Ionicons
              name={
                choice.kind === "deny"
                  ? "close"
                  : choice.kind === "always"
                    ? "shield-checkmark-outline"
                    : "checkmark"
              }
              size={18}
              color={
                primary
                  ? colors.primaryForeground
                  : choice.kind === "deny"
                    ? colors.destructive
                    : colors.foreground
              }
            />
            <Text
              style={{
                color: primary
                  ? colors.primaryForeground
                  : choice.kind === "deny"
                    ? colors.destructive
                    : colors.foreground,
                fontFamily: fonts.sansMedium,
                fontSize: 14,
              }}
            >
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
