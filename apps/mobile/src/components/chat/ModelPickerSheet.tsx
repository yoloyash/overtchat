import type { PublicModelConfig } from "@overtchat/shared";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export function ModelPickerSheet({
  visible,
  models,
  selectedId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  models: PublicModelConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Models
        </Text>
        {models.length === 0 ? (
          <Text
            style={[
              styles.empty,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            No models configured. An admin needs to add one in Settings → Models.
          </Text>
        ) : (
          models.map((m) => {
            const selected = m.id === selectedId;
            return (
              <Pressable
                key={m.id}
                onPress={() => {
                  onSelect(m.id);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: selected ? colors.accent : "transparent",
                    borderRadius: radii.md,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={styles.rowText}>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: colors.popoverForeground,
                        fontFamily: fonts.sansSemiBold,
                      },
                    ]}
                  >
                    {m.label}
                  </Text>
                  <Text
                    style={[
                      styles.sub,
                      {
                        color: colors.mutedForeground,
                        fontFamily: fonts.sansRegular,
                      },
                    ]}
                  >
                    {m.displayProvider} · {m.model}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 12,
  },
  title: { fontSize: 18, marginBottom: 8, paddingHorizontal: 8 },
  empty: { fontSize: 14, paddingHorizontal: 8, paddingVertical: 12 },
  row: { paddingHorizontal: 12, paddingVertical: 12 },
  rowText: { gap: 2 },
  label: { fontSize: 15 },
  sub: { fontSize: 12 },
});
