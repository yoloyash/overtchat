import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import type { PublicModelConfig } from "@overtchat/shared";
import * as Haptics from "expo-haptics";
import { forwardRef, useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { useTheme } from "@/lib/theme";

export type ProjectModelSheetRef = BottomSheetModal;

/** Picks the model new chats in a project start with. */
export const ProjectModelSheet = forwardRef<
  ProjectModelSheetRef,
  {
    models: PublicModelConfig[];
    /** Null selects the account default. */
    selectedId: string | null;
    accountDefault: PublicModelConfig | undefined;
    onSelect: (id: string | null) => void;
  }
>(function ProjectModelSheet(
  { models, selectedId, accountDefault, onSelect },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

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

  function choose(id: string | null) {
    Haptics.selectionAsync().catch(() => {});
    (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
    if (id !== selectedId) onSelect(id);
  }

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      maxDynamicContentSize={height * 0.8}
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
          { paddingBottom: insets.bottom + 16 },
        ]}
      >
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Default model
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          New chats in this project start with this model.
        </Text>
        <View style={styles.options}>
          <ModelOption
            selected={selectedId === null}
            onPress={() => choose(null)}
            label="Account default"
            detail={accountDefault?.label ?? "No models configured"}
            icon={
              <Ionicons
                name="person-circle-outline"
                size={18}
                color={colors.mutedForeground}
              />
            }
          />
          <View
            style={[styles.separator, { backgroundColor: colors.border }]}
          />
          {models.map((model) => (
            <ModelOption
              key={model.id}
              selected={model.id === selectedId}
              onPress={() => choose(model.id)}
              label={model.label}
              icon={
                <ModelBrandIcon
                  iconId={model.modelIconId ?? model.providerIconId}
                  color={colors.popoverForeground}
                  size={16}
                />
              }
            />
          ))}
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function ModelOption({
  label,
  detail,
  icon,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  icon: React.ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderRadius: radii.md,
          backgroundColor: selected || pressed ? colors.muted : "transparent",
        },
      ]}
    >
      <View style={styles.optionIcon}>{icon}</View>
      <View style={styles.optionText}>
        <Text
          numberOfLines={1}
          style={[
            styles.optionLabel,
            { color: colors.popoverForeground, fontFamily: fonts.sansMedium },
          ]}
        >
          {label}
        </Text>
        {detail && (
          <Text
            numberOfLines={1}
            style={[
              styles.optionDetail,
              { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
            ]}
          >
            {detail}
          </Text>
        )}
      </View>
      {selected && (
        <Ionicons name="checkmark" size={18} color={colors.foreground} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 6 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  subtitle: { fontSize: 13, paddingHorizontal: 4 },
  options: { marginTop: 8, gap: 2 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionIcon: { width: 20, alignItems: "center" },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { fontSize: 15 },
  optionDetail: { fontSize: 12, marginTop: 1 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
    marginHorizontal: 12,
  },
});
