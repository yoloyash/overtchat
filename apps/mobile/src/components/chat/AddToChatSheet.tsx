import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import * as Clipboard from "expo-clipboard";
import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type AddToChatSheetRef = BottomSheetModal;

export type AddToChatTool = "camera" | "photos" | "files" | "paste";

const TOOLS: {
  key: AddToChatTool;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: "camera", label: "Camera", icon: "camera-outline" },
  { key: "photos", label: "Photos", icon: "image-outline" },
  { key: "files", label: "Files", icon: "document-outline" },
  { key: "paste", label: "Paste", icon: "clipboard-outline" },
];

export const AddToChatSheet = forwardRef<
  AddToChatSheetRef,
  {
    searchAvailable: boolean;
    searchUnavailableReason: string;
    searchRequested: boolean;
    onToggleSearchRequested: (next: boolean) => void;
    onPickTool?: (tool: AddToChatTool) => void;
    onPasteImage?: (data: string) => void;
  }
>(function AddToChatSheet(
  {
    searchAvailable,
    searchUnavailableReason,
    searchRequested,
    onToggleSearchRequested,
    onPickTool,
    onPasteImage,
  },
  ref,
) {
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
          {TOOLS.map((t) => {
            if (t.key === "paste" && Clipboard.isPasteButtonAvailable) {
              return (
                <Clipboard.ClipboardPasteButton
                  key={t.key}
                  acceptedContentTypes={["image"]}
                  imageOptions={{ format: "png" }}
                  displayMode="iconAndLabel"
                  cornerStyle="fixed"
                  backgroundColor={colors.muted}
                  foregroundColor={colors.popoverForeground}
                  style={styles.tile}
                  onPress={(data) => {
                    if (data.type === "image") onPasteImage?.(data.data);
                  }}
                />
              );
            }

            return (
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
            );
          })}
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
          <View style={styles.toggleCopy}>
            <Text
              style={[
                styles.toggleLabel,
                {
                  color: colors.popoverForeground,
                  fontFamily: fonts.sansMedium,
                },
              ]}
            >
              Search this message
            </Text>
            {!searchAvailable ? (
              <Text
                style={[
                  styles.unavailableLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: fonts.sansRegular,
                  },
                ]}
              >
                {searchUnavailableReason}
              </Text>
            ) : null}
          </View>
          <Switch
            value={searchRequested}
            onValueChange={onToggleSearchRequested}
            disabled={!searchAvailable}
            accessibilityLabel={
              searchAvailable
                ? "Search the web for this message"
                : searchUnavailableReason
            }
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
    height: 72,
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
  toggleCopy: { flex: 1 },
  toggleLabel: { fontSize: 14 },
  unavailableLabel: { fontSize: 12, marginTop: 1 },
});
