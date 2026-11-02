import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
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
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  type ProjectListItem,
  useUpdateProject,
} from "@/lib/queries/projects";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";

export type ProjectInstructionsSheetRef = { present: () => void };

export const ProjectInstructionsSheet = forwardRef<
  ProjectInstructionsSheetRef,
  { project: ProjectListItem }
>(function ProjectInstructionsSheet({ project }, ref) {
  const { colors, radii, fonts } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((state) =>
    state.isVisible ? state.height : 0,
  );
  const sheetRef = useRef<BottomSheetModal>(null);
  const updateMutation = useUpdateProject(project.id);
  const saved = project.instructions ?? "";
  const [draft, setDraft] = useState(saved);

  useImperativeHandle(ref, () => ({
    present() {
      setDraft(project.instructions ?? "");
      requestAnimationFrame(() => sheetRef.current?.present());
    },
  }));

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

  const pending = updateMutation.isPending;
  const canSave = draft !== saved && !pending;
  // The sheet already rises above the keyboard, so only pad for the home
  // indicator when the keyboard is hidden.
  const bottomPadding = keyboardHeight > 0 ? 16 : insets.bottom + 16;
  // Leave room for the keyboard and the sheet's own header and actions.
  const inputMaxHeight = Math.max(
    160,
    height - keyboardHeight - insets.top - 280,
  );

  function save() {
    if (!canSave) return;
    updateMutation.mutate(
      { instructions: draft.trim() ? draft : null },
      {
        onSuccess: () => {
          toastSuccess("Instructions saved");
          sheetRef.current?.dismiss();
        },
        onError: (e) => toastError("Couldn't save instructions", e),
      },
    );
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      topInset={insets.top}
      backdropComponent={renderBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backgroundStyle={{
        backgroundColor: colors.popover,
        borderTopLeftRadius: radii.xl,
        borderTopRightRadius: radii.xl,
      }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
    >
      <BottomSheetView style={[styles.body, { paddingBottom: bottomPadding }]}>
        <Text
          style={[
            styles.title,
            { color: colors.popoverForeground, fontFamily: fonts.serifSemiBold },
          ]}
        >
          Instructions
        </Text>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          Added to every chat in {project.name}: context, tone, or preferences
          the model should always follow.
        </Text>
        <BottomSheetTextInput
          accessibilityLabel="Instructions"
          value={draft}
          onChangeText={setDraft}
          placeholder="e.g. Always respond in concise bullet points. Assume the reader is a senior engineer."
          placeholderTextColor={colors.mutedForeground}
          multiline
          autoFocus
          textAlignVertical="top"
          style={[
            styles.input,
            {
              maxHeight: inputMaxHeight,
              color: colors.foreground,
              backgroundColor: colors.muted,
              borderColor: colors.border,
              borderRadius: radii.md,
              fontFamily: fonts.sansRegular,
            },
          ]}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            disabled={pending}
            onPress={() => sheetRef.current?.dismiss()}
            style={({ pressed }) => [
              styles.button,
              {
                borderColor: colors.border,
                borderRadius: radii.md,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonText,
                { color: colors.foreground, fontFamily: fonts.sansSemiBold },
              ]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save instructions"
            disabled={!canSave}
            onPress={save}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                borderColor: "transparent",
                borderRadius: radii.md,
                opacity: !canSave ? 0.4 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {pending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text
                style={[
                  styles.buttonText,
                  {
                    color: colors.primaryForeground,
                    fontFamily: fonts.sansSemiBold,
                  },
                ]}
              >
                Save
              </Text>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  subtitle: { fontSize: 13, lineHeight: 18, paddingHorizontal: 4 },
  input: {
    fontSize: 15,
    lineHeight: 21,
    minHeight: 180,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 4,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 88,
    alignItems: "center",
  },
  buttonText: { fontSize: 14 },
});
