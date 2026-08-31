import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export function PersonalizationSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.foreground, fontFamily: fonts.sansSemiBold },
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              styles.sectionDescription,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.sectionBody,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.lg,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function PersonalizationDivider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  sectionHeader: { gap: 3, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 15 },
  sectionDescription: { fontSize: 12, lineHeight: 18 },
  sectionBody: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth },
});
