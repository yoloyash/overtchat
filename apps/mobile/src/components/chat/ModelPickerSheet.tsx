import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { PublicModelConfig } from "@overtchat/shared";
import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/lib/theme";

export type ModelPickerSheetRef = BottomSheetModal;

export const ModelPickerSheet = forwardRef<
  ModelPickerSheetRef,
  {
    models: PublicModelConfig[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  }
>(function ModelPickerSheet({ models, selectedId, onSelect }, ref) {
  const { colors, radii, fonts } = useTheme();

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
      <BottomSheetView style={styles.body}>
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
          <View style={styles.list}>
            {models.map((m) => {
              const selected = m.id === selectedId;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    onSelect(m.id);
                    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
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
            })}
          </View>
        )}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  title: { fontSize: 18, marginBottom: 8, paddingHorizontal: 8 },
  empty: { fontSize: 14, paddingHorizontal: 8, paddingVertical: 12 },
  list: { gap: 4 },
  row: { paddingHorizontal: 12, paddingVertical: 12 },
  rowText: { gap: 2 },
  label: { fontSize: 15 },
  sub: { fontSize: 12 },
});
