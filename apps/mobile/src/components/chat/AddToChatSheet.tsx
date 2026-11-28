import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SheetBackdrop, SheetHandle } from "@/components/ui/SheetChrome";
import { forwardRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

export type AddToChatSheetRef = BottomSheetModal;

type ToolKey = "camera" | "photos" | "files";

const TOOLS = [
  { key: "camera" as ToolKey, labelKey: "chat.mobile.addToChat.camera" as const, icon: "camera-outline" as const },
  { key: "photos" as ToolKey, labelKey: "chat.mobile.addToChat.photos" as const, icon: "image-outline" as const },
  { key: "files" as ToolKey, labelKey: "chat.mobile.addToChat.files" as const, icon: "document-outline" as const },
];

export const AddToChatSheet = forwardRef<
  AddToChatSheetRef,
  {
    imageAvailable?: boolean;
    onCreateImage?: () => void;
    searchAvailable: boolean;
    searchUnavailableReason: string;
    searchRequested: boolean;
    onToggleSearchRequested: (next: boolean) => void;
    openuiAvailable?: boolean;
    openuiUnavailableReason?: string;
    openuiRequested?: boolean;
    onToggleOpenUIRequested?: (next: boolean) => void;
    onPickTool?: (tool: ToolKey) => void;
  }
>(function AddToChatSheet(
  {
    imageAvailable, onCreateImage,
    searchAvailable,
    searchUnavailableReason,
    searchRequested,
    onToggleSearchRequested,
    openuiAvailable = false,
    openuiUnavailableReason = "",
    openuiRequested = false,
    onToggleOpenUIRequested,
    onPickTool,
  },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <SheetBackdrop
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
      handleComponent={SheetHandle}
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
          {t("chat.mobile.addToChat.title")}
        </Text>

        <View style={styles.tileRow}>
          {TOOLS.map((tool) => (
            <Pressable
              key={tool.key}
              onPress={() => onPickTool?.(tool.key)}
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
                name={tool.icon}
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
                {t(tool.labelKey)}
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
              {t("chat.mobile.addToChat.searchThisMessage")}
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
                ? t("chat.commands.items.search.description")
                : searchUnavailableReason
            }
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.background}
          />
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
            name="grid-outline"
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
              {t("chat.composer.interactiveUI")}
            </Text>
            {!openuiAvailable && openuiUnavailableReason ? (
              <Text
                style={[
                  styles.unavailableLabel,
                  {
                    color: colors.mutedForeground,
                    fontFamily: fonts.sansRegular,
                  },
                ]}
              >
                {openuiUnavailableReason}
              </Text>
            ) : null}
          </View>
          <Switch
            value={openuiRequested}
            onValueChange={onToggleOpenUIRequested}
            disabled={!openuiAvailable}
            accessibilityLabel={
              openuiAvailable
                ? t("chat.mobile.addToChat.renderInteractiveUI")
                : openuiUnavailableReason
            }
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.background}
          />
        </View>
        {imageAvailable && <Pressable accessibilityRole="button" onPress={onCreateImage} style={{ padding: 12, opacity: imageAvailable ? 1 : 0.5 }}>
          <Text style={{ color: colors.popoverForeground, fontFamily: fonts.sansMedium }}>{t("chat.composer.createImage")}</Text>
        </Pressable>}
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
  toggleCopy: { flex: 1 },
  toggleLabel: { fontSize: 14 },
  unavailableLabel: { fontSize: 12, marginTop: 1 },
});
