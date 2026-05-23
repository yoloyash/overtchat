import { Feather } from "@expo/vector-icons";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

export function MessageActionSheet({
  visible,
  actions,
  onSelect,
  onClose,
}: {
  visible: boolean;
  actions: MessageAction[];
  onSelect: (action: MessageAction) => void;
  onClose: () => void;
}) {
  const { colors, radii, fonts } = useTheme();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.scrim} onPress={onClose} />
      <SafeAreaView
        edges={["bottom"]}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.popover,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.handle} />
        {actions.map((a) => {
          const meta = ACTION_META[a];
          return (
            <Pressable
              key={a}
              onPress={() => {
                onSelect(a);
                onClose();
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? colors.accent : "transparent",
                  borderRadius: radii.md,
                },
              ]}
            >
              <Feather name={meta.icon} size={18} color={colors.popoverForeground} />
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
            </Pressable>
          );
        })}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: { fontSize: 15 },
});
