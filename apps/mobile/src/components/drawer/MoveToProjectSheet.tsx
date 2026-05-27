import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProjectListItem } from "@/lib/queries/projects";
import { useTheme } from "@/lib/theme";

export type MoveToProjectSheetRef = BottomSheetModal;

export const MoveToProjectSheet = forwardRef<
  MoveToProjectSheetRef,
  {
    projects: ProjectListItem[];
    currentProjectId: string | null;
    onSelect: (projectId: string | null) => void;
  }
>(function MoveToProjectSheet({ projects, currentProjectId, onSelect }, ref) {
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

  function pick(projectId: string | null) {
    onSelect(projectId);
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
  }

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
      <BottomSheetScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: 16 + insets.bottom },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Move to project
        </Text>

        <Row
          label="No project"
          icon="remove-circle-outline"
          selected={currentProjectId === null}
          onPress={() => pick(null)}
        />

        {projects.length > 0 && (
          <View
            style={[styles.divider, { backgroundColor: colors.border }]}
          />
        )}

        {projects.length === 0 ? (
          <Text
            style={[
              styles.empty,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            You haven't created any projects yet.
          </Text>
        ) : (
          projects.map((p) => (
            <Row
              key={p.id}
              label={p.name}
              icon="folder-outline"
              selected={currentProjectId === p.id}
              onPress={() => pick(p.id)}
            />
          ))
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function Row({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={selected}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.accent : "transparent",
          borderRadius: radii.md,
          opacity: selected ? 0.55 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.mutedForeground} />
      <Text
        numberOfLines={1}
        style={[
          styles.rowLabel,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {label}
      </Text>
      {selected && (
        <Ionicons
          name="checkmark"
          size={18}
          color={colors.mutedForeground}
          style={styles.rowCheck}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 4, gap: 4 },
  title: { fontSize: 18, paddingHorizontal: 8, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowLabel: { fontSize: 15, flex: 1 },
  rowCheck: { marginLeft: "auto" },
  empty: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 16 },
});
