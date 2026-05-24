import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import type { Component, RefObject } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Popover, { PopoverPlacement } from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type MessageAction = "copy" | "edit" | "regenerate";

const ACTION_META: Record<
  MessageAction,
  { label: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  copy: { label: "Copy", icon: "copy" },
  edit: { label: "Edit", icon: "edit-3" },
  regenerate: { label: "Regenerate", icon: "rotate-ccw" },
};

export function MessageMenu({
  from,
  visible,
  actions,
  placement,
  onSelect,
  onClose,
}: {
  from: RefObject<Component | null>;
  visible: boolean;
  actions: MessageAction[];
  placement: "top" | "bottom";
  onSelect: (action: MessageAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();

  return (
    <Popover
      from={from as RefObject<Component>}
      isVisible={visible}
      onRequestClose={onClose}
      placement={
        placement === "top" ? PopoverPlacement.TOP : PopoverPlacement.BOTTOM
      }
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
        {actions.map((a) => {
          const meta = ACTION_META[a];
          return (
            <Pressable
              key={a}
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
                  {
                    color: colors.popoverForeground,
                    fontFamily: fonts.sansMedium,
                  },
                ]}
              >
                {meta.label}
              </Text>
              <Feather
                name={meta.icon}
                size={16}
                color={colors.popoverForeground}
              />
            </Pressable>
          );
        })}
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  menu: { minWidth: 160 },
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
