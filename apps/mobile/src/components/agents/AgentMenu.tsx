import { useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Popover, {
  PopoverPlacement,
  type Rect,
} from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type AgentMenuItem = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  destructive?: boolean;
  onSelect: () => void;
};

export type AgentMenuSection = {
  /** Short context shown above the section, such as an irreversibility warning. */
  note?: string;
  items: AgentMenuItem[];
};

/**
 * Anchored action menu for transcript controls. Actions run after the popover
 * finishes closing so navigation never races its native modal.
 */
export function AgentMenu({
  from,
  visible,
  sections,
  onClose,
}: {
  from: Rect | null;
  visible: boolean;
  sections: AgentMenuSection[];
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const selected = useRef<(() => void) | null>(null);
  return (
    <Popover
      from={from ?? undefined}
      isVisible={visible && !!from}
      onRequestClose={onClose}
      onCloseComplete={() => {
        const action = selected.current;
        selected.current = null;
        action?.();
      }}
      placement={PopoverPlacement.AUTO}
      offset={4}
      arrowSize={{ width: 0, height: 0 }}
      popoverStyle={{
        backgroundColor: colors.popover,
        borderRadius: radii.lg,
        borderColor: colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        paddingVertical: 4,
      }}
      backgroundStyle={{ backgroundColor: "rgba(0,0,0,0.15)" }}
    >
      <View accessibilityRole="menu" style={styles.menu}>
        {sections
          .filter((section) => section.items.length > 0)
          .map((section, index) => (
            <View
              key={section.items[0].key}
              style={
                index > 0
                  ? [styles.section, { borderTopColor: colors.border }]
                  : undefined
              }
            >
              {!!section.note && (
                <Text
                  style={[
                    styles.note,
                    {
                      color: colors.mutedForeground,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                >
                  {section.note}
                </Text>
              )}
              {section.items.map((item) => {
                const tint = item.destructive
                  ? colors.destructive
                  : colors.popoverForeground;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={item.label}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      selected.current = item.onSelect;
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      { backgroundColor: pressed ? colors.accent : "transparent" },
                    ]}
                  >
                    <Text
                      style={{
                        flexShrink: 1,
                        color: tint,
                        fontFamily: fonts.sansMedium,
                        fontSize: 14,
                      }}
                    >
                      {item.label}
                    </Text>
                    <Ionicons name={item.icon} size={17} color={tint} />
                  </Pressable>
                );
              })}
            </View>
          ))}
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  menu: { minWidth: 220, maxWidth: 300 },
  section: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  note: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
