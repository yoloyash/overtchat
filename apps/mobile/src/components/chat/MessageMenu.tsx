import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Popover, {
  PopoverPlacement,
  type Rect,
} from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type MessageAction = "copy" | "edit" | "regenerate" | "continue";

const ACTION_META = {
  copy: { labelKey: "common.actions.copy", icon: "copy" },
  edit: { labelKey: "common.actions.edit", icon: "edit-3" },
  regenerate: { labelKey: "chat.messages.regenerate", icon: "rotate-ccw" },
  continue: { labelKey: "chat.messages.continueResponse", icon: "play" },
} as const satisfies Record<
  MessageAction,
  { labelKey: string; icon: React.ComponentProps<typeof Feather>["name"] }
>;

export function MessageMenu({
  from,
  visible,
  actions,
  placement,
  onSelect,
  onClose,
}: {
  from: Rect | null;
  visible: boolean;
  actions: MessageAction[];
  placement: "top" | "bottom";
  onSelect: (action: MessageAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();

  return (
    <Popover
      from={from ?? undefined}
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
                {t(meta.labelKey)}
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
