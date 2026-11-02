import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet } from "react-native";
import {
  ChatRowMenu,
  type ChatRowAction,
} from "@/components/drawer/ChatRowMenu";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { useTheme } from "@/lib/theme";

/**
 * Header kebab for the open chat: pin, share, rename, move, delete. The
 * button stays mounted on an unsaved chat (greyed out) so the header does not
 * reflow once the first response lands.
 */
export function ChatHeaderMenu({
  title,
  pinned,
  pinPending,
  pinningSupported,
  disabled,
  disabledActions,
  onSelect,
}: {
  title: string | null;
  pinned: boolean;
  pinPending: boolean;
  pinningSupported: boolean;
  disabled: boolean;
  disabledActions: readonly ChatRowAction[];
  onSelect: (action: ChatRowAction) => void;
}) {
  const { colors } = useTheme();
  const menu = useMeasuredPopoverAnchor();
  return (
    <>
      <Pressable
        ref={menu.anchorRef}
        accessibilityRole="button"
        accessibilityLabel="Chat actions"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={menu.open}
        hitSlop={10}
        style={[styles.button, { opacity: disabled ? 0.4 : 1 }]}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.foreground} />
      </Pressable>
      <ChatRowMenu
        from={menu.anchorRect}
        visible={menu.visible}
        title={title}
        pinned={pinned}
        pinPending={pinPending}
        pinningSupported={pinningSupported}
        shareable
        disabledActions={disabledActions}
        onClose={menu.close}
        onSelect={onSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { padding: 12 },
});
