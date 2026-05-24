import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { Component, RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Popover, { PopoverPlacement } from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type ChatRowAction = "rename" | "delete";

const ACTION_META: Record<
  ChatRowAction,
  {
    label: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    destructive?: boolean;
  }
> = {
  rename: { label: "Rename", icon: "edit-3" },
  delete: { label: "Delete", icon: "trash-2", destructive: true },
};

export function ChatRowMenu({
  from,
  visible,
  onSelect,
  onClose,
}: {
  from: RefObject<Component | null>;
  visible: boolean;
  onSelect: (action: ChatRowAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();

  return (
    <Popover
      from={from as RefObject<Component>}
      isVisible={visible}
      onRequestClose={onClose}
      placement={PopoverPlacement.AUTO}
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
      <View style={styles.menu}>
        {(Object.keys(ACTION_META) as ChatRowAction[]).map((a) => {
          const meta = ACTION_META[a];
          const tint = meta.destructive
            ? colors.destructive
            : colors.popoverForeground;
          return (
            <Pressable
              key={a}
              accessibilityRole="button"
              accessibilityLabel={meta.label}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onClose();
                onSelect(a);
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors.accent : "transparent" },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: tint, fontFamily: fonts.sansMedium },
                ]}
              >
                {meta.label}
              </Text>
              <Feather name={meta.icon} size={16} color={tint} />
            </Pressable>
          );
        })}
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  menu: { minWidth: 180 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  label: { fontSize: 14 },
});
