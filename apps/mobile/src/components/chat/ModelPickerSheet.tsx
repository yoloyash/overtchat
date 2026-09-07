import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import type {
  ChatReasoningLevel,
  ModelReasoningControls,
  ModelReasoningLevel,
  PublicModelConfig,
} from "@overtchat/shared";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
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

type ModelPickerPanel = "models" | "thinking";

export interface ModelPickerSheetRef {
  present: (panel?: ModelPickerPanel) => void;
  dismiss: () => void;
}

const SEARCH_THRESHOLD = 7;

export const ModelPickerSheet = forwardRef<
  ModelPickerSheetRef,
  {
    models: PublicModelConfig[];
    selectedId: string | null;
    loading?: boolean;
    error?: Error | null;
    reasoningControls?: ModelReasoningControls;
    reasoningLevel: ChatReasoningLevel;
    onSelect: (id: string) => void;
    onSelectReasoningLevel: (level: ChatReasoningLevel) => void;
  }
>(function ModelPickerSheet(
  {
    models,
    selectedId,
    loading = false,
    error = null,
    reasoningControls,
    reasoningLevel,
    onSelect,
    onSelectReasoningLevel,
  },
  ref,
) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const modalRef = useRef<BottomSheetModal>(null);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<ModelPickerPanel>("models");
  const sheetMaxHeight = Math.min(640, Math.round(height * 0.86));
  const showSearch =
    panel === "models" &&
    !loading &&
    !error &&
    models.length > SEARCH_THRESHOLD;
  const searchTerm = search.trim();
  const selectedModel = models.find((model) => model.id === selectedId);
  const reasoningOptions = useMemo(
    () => reasoningOptionsForControls(reasoningControls),
    [reasoningControls],
  );
  const effectiveReasoningLevel =
    reasoningLevel === "default"
      ? reasoningControls?.defaultLevel
      : reasoningLevel;
  const showThinking = reasoningOptions.length > 1;

  useImperativeHandle(ref, () => ({
    present(nextPanel = "models") {
      setSearch("");
      setPanel(nextPanel);
      modalRef.current?.present();
    },
    dismiss() {
      modalRef.current?.dismiss();
    },
  }));

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
      ref={modalRef}
      enableDynamicSizing
      maxDynamicContentSize={sheetMaxHeight}
      backdropComponent={renderBackdrop}
      onDismiss={() => {
        setSearch("");
        setPanel("models");
      }}
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
        showsVerticalScrollIndicator={
          panel === "models" && models.length > SEARCH_THRESHOLD
        }
      >
        <View style={styles.titleRow}>
          {panel === "thinking" ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to models"
              onPress={() => setPanel("models")}
              style={({ pressed }) => [
                styles.backButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="chevron-back"
                size={21}
                color={colors.popoverForeground}
              />
            </Pressable>
          ) : null}
          <View style={styles.titleCopy}>
            <Text
              style={[
                styles.title,
                {
                  color: colors.popoverForeground,
                  fontFamily: fonts.serifSemiBold,
                },
              ]}
            >
              {panel === "thinking" ? "Thinking" : "Models"}
            </Text>
            {panel === "thinking" && selectedModel ? (
              <Text
                numberOfLines={1}
                style={[
                  styles.titleSubtitle,
                  {
                    color: colors.mutedForeground,
                    fontFamily: fonts.sansRegular,
                  },
                ]}
              >
                {selectedModel.label}
              </Text>
            ) : null}
          </View>
        </View>

        {panel === "models" && showThinking && effectiveReasoningLevel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Thinking level: ${reasoningLabel(effectiveReasoningLevel)}`}
            onPress={() => {
              setSearch("");
              setPanel("thinking");
            }}
            style={({ pressed }) => [
              styles.thinkingControl,
              {
                backgroundColor: pressed ? colors.accent : colors.muted,
                borderRadius: radii.md,
              },
            ]}
          >
            <Ionicons
              name="bulb-outline"
              size={18}
              color={colors.popoverForeground}
            />
            <Text
              style={[
                styles.thinkingControlLabel,
                {
                  color: colors.popoverForeground,
                  fontFamily: fonts.sansMedium,
                },
              ]}
            >
              Thinking
            </Text>
            <Text
              numberOfLines={1}
              style={[
                styles.thinkingControlValue,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              {reasoningLabel(effectiveReasoningLevel)}
              {effectiveReasoningLevel === reasoningControls?.defaultLevel
                ? " (default)"
                : ""}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={17}
              color={colors.mutedForeground}
            />
          </Pressable>
        ) : null}

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
                onPress={() => setSearch("")}
                style={({ pressed }) => [
                  styles.searchClearButton,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
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

        {panel === "thinking" ? (
          <View accessibilityRole="radiogroup" style={styles.list}>
            {reasoningOptions.map((option) => (
              <ReasoningRow
                key={option}
                option={option}
                selected={option === effectiveReasoningLevel}
                isDefault={option === reasoningControls?.defaultLevel}
                onPress={() => {
                  onSelectReasoningLevel(option);
                  modalRef.current?.dismiss();
                }}
              />
            ))}
          </View>
        ) : loading ? (
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
                  modalRef.current?.dismiss();
                }}
              />
            ))}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

function ReasoningRow({
  option,
  selected,
  isDefault,
  onPress,
}: {
  option: ModelReasoningLevel;
  selected: boolean;
  isDefault: boolean;
  onPress: () => void;
}) {
  const { colors, radii, fonts } = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
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
      <Ionicons name="bulb-outline" size={17} color={colors.mutedForeground} />
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
          {reasoningLabel(option)}
          {isDefault ? " (default)" : ""}
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

export function reasoningOptionsForControls(
  controls: ModelReasoningControls | undefined,
): ModelReasoningLevel[] {
  if (!controls) return [];
  const options: ModelReasoningLevel[] = [];
  if (controls.efforts?.length) {
    if (controls.toggle) options.push("off");
    if (controls.defaultLevel === "on") options.push("on");
    options.push(...controls.efforts);
  } else if (controls.toggle) {
    options.push("on", "off");
  }
  return [...new Set(options)];
}

export function reasoningLabel(level: ChatReasoningLevel): string {
  if (level === "xhigh") return "Extra high";
  return level.charAt(0).toUpperCase() + level.slice(1);
}

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
  titleRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  backButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  titleCopy: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  title: { fontSize: 18 },
  titleSubtitle: { fontSize: 12, marginTop: 1 },
  thinkingControl: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    marginBottom: 4,
  },
  thinkingControlLabel: { fontSize: 14 },
  thinkingControlValue: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    textAlign: "right",
  },
  searchBox: {
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  searchClearButton: {
    width: 48,
    height: 48,
    marginRight: -12,
    alignItems: "center",
    justifyContent: "center",
  },
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
