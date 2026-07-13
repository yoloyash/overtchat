import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type { PublicModelConfig } from "@overtchat/shared";
import { forwardRef, useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModelBrandIcon } from "@/components/ModelBrandIcon";
import { useTheme } from "@/lib/theme";

export type ModelPickerSheetRef = BottomSheetModal;

const SEARCH_THRESHOLD = 7;

export const ModelPickerSheet = forwardRef<
  ModelPickerSheetRef,
  {
    models: PublicModelConfig[];
    selectedId: string | null;
    loading?: boolean;
    error?: Error | null;
    onSelect: (id: string) => void;
  }
>(function ModelPickerSheet(
  { models, selectedId, loading = false, error = null, onSelect },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const sheetMaxHeight = Math.min(640, Math.round(height * 0.86));
  const showSearch = !loading && !error && models.length > SEARCH_THRESHOLD;
  const searchTerm = search.trim();

  const filteredModels = useMemo(() => {
    if (!searchTerm) return models;
    const q = searchTerm.toLowerCase();
    return models.filter((m) =>
      [m.label, m.model, m.displayProvider].join(" ").toLowerCase().includes(q),
    );
  }, [models, searchTerm]);

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
      maxDynamicContentSize={sheetMaxHeight}
      backdropComponent={renderBackdrop}
      onDismiss={() => setSearch("")}
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
          { paddingBottom: 20 + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={models.length > SEARCH_THRESHOLD}
      >
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Models
        </Text>

        {showSearch ? (
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderRadius: radii.md,
              },
            ]}
          >
            <Ionicons name="search-outline" size={17} color={colors.mutedForeground} />
            <BottomSheetTextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search models"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[
                styles.searchInput,
                { color: colors.foreground, fontFamily: fonts.sansRegular },
              ]}
            />
            {search.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear model search"
                hitSlop={8}
                onPress={() => setSearch("")}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {loading ? (
          <StatusState
            title="Loading models…"
            icon={<ActivityIndicator color={colors.mutedForeground} />}
          />
        ) : error ? (
          <StatusState
            title="Couldn't load models"
            message={error.message}
            tone="error"
          />
        ) : models.length === 0 ? (
          <StatusState
            title="No models configured"
            message="An admin can add one in Settings → Models on the web."
          />
        ) : filteredModels.length === 0 ? (
          <StatusState
            title={`No models match "${searchTerm}"`}
            message="Try a model, provider, or endpoint name."
          />
        ) : (
          <View style={styles.list}>
            {filteredModels.map((model) => (
              <ModelRow
                key={model.id}
                model={model}
                selected={model.id === selectedId}
                onPress={() => {
                  onSelect(model.id);
                  setSearch("");
                  (ref as React.RefObject<BottomSheetModal>)?.current?.dismiss();
                }}
              />
            ))}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function ModelRow({
  model,
  selected,
  onPress,
}: {
  model: PublicModelConfig;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected || pressed ? colors.accent : "transparent",
          borderRadius: radii.md,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <ModelBrandIcon
        iconId={model.modelIconId ?? model.providerIconId}
        color={colors.mutedForeground}
        size={17}
        style={styles.rowIcon}
      />
      <View style={styles.rowText}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[
            styles.label,
            {
              color: colors.popoverForeground,
              fontFamily: fonts.sansSemiBold,
            },
          ]}
        >
          {model.label}
        </Text>
      </View>
      {selected ? (
        <Ionicons
          name="checkmark"
          size={18}
          color={colors.primary}
          style={styles.rowCheck}
        />
      ) : null}
    </Pressable>
  );
}

function StatusState({
  title,
  message,
  icon,
  tone = "muted",
}: {
  title: string;
  message?: string;
  icon?: React.ReactNode;
  tone?: "muted" | "error";
}) {
  const { colors, fonts } = useTheme();
  const textColor = tone === "error" ? colors.destructive : colors.mutedForeground;
  return (
    <View style={styles.status}>
      {icon}
      <Text
        style={[
          styles.statusTitle,
          { color: textColor, fontFamily: fonts.sansSemiBold },
        ]}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={[
            styles.statusMessage,
            { color: textColor, fontFamily: fonts.sansRegular },
          ]}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 4, gap: 8 },
  title: { fontSize: 18, paddingHorizontal: 8, paddingBottom: 8 },
  searchBox: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  list: { gap: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowIcon: { flexShrink: 0 },
  rowText: { flex: 1, minWidth: 0 },
  label: { fontSize: 15 },
  rowCheck: { marginLeft: "auto" },
  status: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  statusTitle: { fontSize: 14, textAlign: "center" },
  statusMessage: { fontSize: 13, lineHeight: 19, textAlign: "center" },
});
