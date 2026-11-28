import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { SheetBackdrop, SheetHandle } from "@/components/ui/SheetChrome";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme";

const sources = [
  { camera: true, labelKey: "agents.mobile.attachSheet.camera", icon: "camera-outline" },
  { camera: false, labelKey: "agents.mobile.attachSheet.photos", icon: "image-outline" },
] as const;

/** Image sources for an agent message, presented like the chat attach sheet. */
export function AgentAttachSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (camera: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<BottomSheetModal>(null);
  const presented = useRef(false);
  const picked = useRef<boolean | null>(null);
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (visible && !presented.current) {
      presented.current = true;
      ref.current?.present();
    } else if (!visible && presented.current) {
      presented.current = false;
      ref.current?.dismiss();
    }
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      ref.current?.dismiss();
      return true;
    });
    return () => listener.remove();
  }, [visible]);
  const backdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
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
      backdropComponent={backdrop}
      onDismiss={() => {
        presented.current = false;
        onClose();
        // The image picker presents its own controller; open it after the sheet is gone.
        const camera = picked.current;
        picked.current = null;
        if (camera !== null) onPick(camera);
      }}
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetView style={[styles.body, { paddingBottom: 16 + insets.bottom }]}>
        <Text
          accessibilityRole="header"
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          {t("agents.mobile.attachSheet.title")}
        </Text>
        <View style={styles.tiles}>
          {sources.map((source) => {
            const label = t(source.labelKey);
            return (
            <Pressable
              key={source.labelKey}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => {
                picked.current = source.camera;
                ref.current?.dismiss();
              }}
              style={({ pressed }) => [
                styles.tile,
                {
                  backgroundColor: colors.muted,
                  borderRadius: radii.lg,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name={source.icon} size={22} color={colors.popoverForeground} />
              <Text
                style={{
                  color: colors.popoverForeground,
                  fontFamily: fonts.sansMedium,
                  fontSize: 13,
                }}
              >
                {label}
              </Text>
            </Pressable>
            );
          })}
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: {
    flex: 1,
    aspectRatio: 1.6,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
