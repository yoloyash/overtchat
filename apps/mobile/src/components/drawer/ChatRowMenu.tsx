import { Feather, Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Popover, {
  PopoverPlacement,
  type Rect,
} from "react-native-popover-view";
import { useTheme } from "@/lib/theme";

export type ChatRowAction =
  | "pin"
  | "unpin"
  | "share"
  | "rename"
  | "move"
  | "delete";

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
  share: { label: "Share", icon: "share" },
  rename: { label: "Rename", icon: "edit-3" },
  move: { label: "Move to project", icon: "folder" },
  delete: { label: "Delete", icon: "trash-2", destructive: true },
};

/**
 * Per-chat action popover shared by the drawer rows (long press) and the chat
 * header kebab. `shareable` adds the Share row; `disabledActions` greys out
 * actions that would conflict with an in-flight response.
 */
export function ChatRowMenu({
  from,
  visible,
  title,
  pinned,
  pinPending,
  pinningSupported,
  shareable = false,
  disabledActions,
  onSelect,
  onClose,
}: {
  from: Rect | null;
  visible: boolean;
  title?: string | null;
  pinned: boolean;
  pinPending: boolean;
  pinningSupported: boolean;
  shareable?: boolean;
  disabledActions?: readonly ChatRowAction[];
  onSelect: (action: ChatRowAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  const actions: ChatRowAction[] = ["rename", "move", "delete"];
  if (shareable) actions.unshift("share");
  if (pinningSupported) actions.unshift(pinned ? "unpin" : "pin");
  const heading = title?.trim() || "";

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
        {heading ? (
          <Text
            numberOfLines={1}
            accessibilityRole="header"
            style={[
              styles.heading,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {heading}
          </Text>
        ) : null}
        {actions.map((a) => {
          const meta = ACTION_META[a];
          const disabled =
            (pinPending && (a === "pin" || a === "unpin")) ||
            (disabledActions?.includes(a) ?? false);
          const tint = meta.destructive
            ? colors.destructive
            : colors.popoverForeground;
          return (
            <Pressable
              key={a}
              accessibilityRole="button"
              accessibilityLabel={meta.label}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onClose();
                onSelect(a);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? colors.accent : "transparent",
                  opacity: disabled ? 0.4 : 1,
                },
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
  menu: { minWidth: 180, maxWidth: 280 },
  heading: {
    fontSize: 12,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
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
