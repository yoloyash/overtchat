import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { ACCENT_OPTIONS } from "@overtchat/shared";
import { accentSwatchesRgb } from "@overtchat/shared/theme.rn";
import { setAccentPref, useAccentPref } from "@/lib/accentPref";
import { useTheme } from "@/lib/theme";

export function AccentPicker() {
  const accent = useAccentPref();
  const { colors, fonts, radii } = useTheme();
  const { fontScale } = useWindowDimensions();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Accent color"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        paddingHorizontal: 12,
        paddingBottom: 12,
      }}
    >
      {ACCENT_OPTIONS.map(({ id, label }) => {
        const selected = accent === id;
        return (
          <View key={id} style={{ width: fontScale > 1.3 ? "50%" : "25%", padding: 4 }}>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected }}
              onPress={() => setAccentPref(id)}
              style={({ pressed }) => ({
                minHeight: 68,
                padding: 8,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: selected ? colors.ring : "transparent",
                backgroundColor: selected ? colors.accent : "transparent",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: accentSwatchesRgb[id],
                }}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: fonts.sansMedium,
                  color: selected ? colors.accentForeground : colors.mutedForeground,
                }}
              >
                {label}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}
