import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Popover, {
  PopoverPlacement,
  type Rect,
} from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type ChatRowAction = "pin" | "unpin" | "rename" | "move" | "delete";

const ACTION_META: Record<
  ChatRowAction,
  {
    label: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    destructive?: boolean;
  }
> = {
  pin: { label: "Pin", icon: "bookmark" },
  unpin: { label: "Unpin", icon: "bookmark" },
  rename: { label: "Rename", icon: "edit-3" },
  move: { label: "Move to project", icon: "folder" },
  delete: { label: "Delete", icon: "trash-2", destructive: true },
};

export function ChatRowMenu({
  from,
  visible,
  pinned,
  pinPending,
  pinningSupported,
  onSelect,
  onClose,
}: {
  from: Rect | null;
  visible: boolean;
  pinned: boolean;
  pinPending: boolean;
  pinningSupported: boolean;
  onSelect: (action: ChatRowAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const actions: ChatRowAction[] = ["rename", "move", "delete"];
  if (pinningSupported) actions.unshift(pinned ? "unpin" : "pin");

  return (
    <Popover
      from={from ?? undefined}
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
        {actions.map((a) => {
          const meta = ACTION_META[a];
          const tint = meta.destructive
            ? colors.destructive
            : colors.popoverForeground;
          return (
            <Pressable
              key={a}
              accessibilityRole="button"
              accessibilityLabel={meta.label}
              disabled={pinPending && (a === "pin" || a === "unpin")}
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
              {a === "pin" || a === "unpin" ? (
                <Ionicons name="pin-outline" size={16} color={tint} />
              ) : (
                <Feather name={meta.icon} size={16} color={tint} />
              )}
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
