import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type AddToChatSheetRef = BottomSheetModal;

type ToolKey = "camera" | "photos" | "files";

const TOOLS: { key: ToolKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "camera", label: "Camera", icon: "camera-outline" },
  { key: "photos", label: "Photos", icon: "image-outline" },
  { key: "files", label: "Files", icon: "document-outline" },
];

export const AddToChatSheet = forwardRef<
  AddToChatSheetRef,
  {
    searchEnabled: boolean;
    onToggleSearch: (next: boolean) => void;
    onPickTool?: (tool: ToolKey) => void;
  }
>(function AddToChatSheet({ searchEnabled, onToggleSearch, onPickTool }, ref) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetView style={[styles.body, { paddingBottom: 16 + insets.bottom }]}>
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Add to chat
        </Text>

        <View style={styles.tileRow}>
          {TOOLS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => onPickTool?.(t.key)}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: colors.muted,
                  borderRadius: radii.lg,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name={t.icon}
                size={22}
                color={colors.popoverForeground}
              />
              <Text
                style={[
                  styles.tileLabel,
                  {
                    color: colors.popoverForeground,
                    fontFamily: fonts.sansMedium,
                  },
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View
          style={[
            styles.toggleRow,
            {
              backgroundColor: colors.muted,
              borderRadius: radii.lg,
            },
          ]}
        >
          <Ionicons
            name="globe-outline"
            size={18}
            color={colors.popoverForeground}
          />
          <Text
            style={[
              styles.toggleLabel,
              {
                color: colors.popoverForeground,
                fontFamily: fonts.sansMedium,
              },
            ]}
          >
            Web search
          </Text>
          <Switch
            value={searchEnabled}
            onValueChange={onToggleSearch}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.background}
          />
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  tileRow: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    aspectRatio: 1.1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tileLabel: { fontSize: 13 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleLabel: { flex: 1, fontSize: 14 },
});
