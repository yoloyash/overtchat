import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import {
  MEMORY_KEY_MAX_LENGTH,
  MEMORY_VALUE_MAX_LENGTH,
  type Memory,
} from "@overtchat/shared";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useCreateMemory,
  useUpdateMemory,
} from "@/lib/queries/personalization";
import { useTheme } from "@/lib/theme";
import { toastSuccess } from "@/lib/toast";

export type MemoryEditorSheetRef = {
  present: (memory?: Memory) => void;
};

export const MemoryEditorSheet = forwardRef<MemoryEditorSheetRef>(
  function MemoryEditorSheet(_props, ref) {
    const { colors, radii, fonts } = useTheme();
    const insets = useSafeAreaInsets();
    const keyboardHeight = useKeyboardState((state) =>
      state.isVisible ? state.height : 0,
    );
    const sheetRef = useRef<BottomSheetModal>(null);
    const createMemory = useCreateMemory();
    const updateMemory = useUpdateMemory();
    const [memory, setMemory] = useState<Memory | null>(null);
    const [key, setKey] = useState("");
    const [value, setValue] = useState("");
    const [error, setError] = useState("");

    useImperativeHandle(ref, () => ({
      present(nextMemory) {
        const selected = nextMemory ?? null;
        setMemory(selected);
        setKey(selected?.key ?? "");
        setValue(selected?.value ?? "");
        setError("");
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

    const pending = createMemory.isPending || updateMemory.isPending;
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    const changed =
      memory === null ||
      trimmedKey !== memory.key ||
      trimmedValue !== memory.value;
    const canSubmit =
      trimmedKey.length > 0 &&
      trimmedValue.length > 0 &&
      changed &&
      !pending;
    const bottomPadding =
      keyboardHeight > 0 ? keyboardHeight + 16 : insets.bottom + 16;

    async function submit() {
      if (!canSubmit) return;
      setError("");
      try {
        if (memory) {
          await updateMemory.mutateAsync({
            id: memory.id,
            input: { key: trimmedKey, value: trimmedValue },
          });
          toastSuccess("Memory updated");
        } else {
          await createMemory.mutateAsync({
            key: trimmedKey,
            value: trimmedValue,
          });
          toastSuccess("Memory added");
        }
        sheetRef.current?.dismiss();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Couldn't save memory.",
        );
      }
    }

    return (
      <BottomSheetModal
        ref={sheetRef}
        enableDynamicSizing
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
        <BottomSheetView
          style={[styles.body, { paddingBottom: bottomPadding }]}
        >
          <Text
            style={[
              styles.title,
              {
                color: colors.popoverForeground,
                fontFamily: fonts.serifSemiBold,
              },
            ]}
          >
            {memory ? "Edit memory" : "Add memory"}
          </Text>
          <Text
            style={[
              styles.subtitle,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            Saved memories are included in future chats when personalization is
            on.
          </Text>

          <View style={styles.field}>
            <Text
              style={[
                styles.label,
                { color: colors.foreground, fontFamily: fonts.sansMedium },
              ]}
            >
              What should OvertChat remember?
            </Text>
            <BottomSheetTextInput
              accessibilityLabel="Memory value"
              value={value}
              onChangeText={(next) => {
                setValue(next);
                setError("");
              }}
              placeholder="Prefer concise answers."
              placeholderTextColor={colors.mutedForeground}
              maxLength={MEMORY_VALUE_MAX_LENGTH}
              multiline
              textAlignVertical="top"
              style={[
                styles.valueInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            />
          </View>

          <View style={styles.field}>
            <Text
              style={[
                styles.label,
                { color: colors.foreground, fontFamily: fonts.sansMedium },
              ]}
            >
              Label
            </Text>
            <BottomSheetTextInput
              accessibilityLabel="Memory key"
              value={key}
              onChangeText={(next) => {
                setKey(next);
                setError("");
              }}
              placeholder="response_style"
              placeholderTextColor={colors.mutedForeground}
              maxLength={MEMORY_KEY_MAX_LENGTH}
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.keyInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.muted,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            />
            <Text
              style={[
                styles.hint,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              Start with a letter and use lowercase letters, numbers, or
              underscores.
            </Text>
          </View>

          {error ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.error,
                { color: colors.destructive, fontFamily: fonts.sansRegular },
              ]}
            >
              {error}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
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
              accessibilityLabel={memory ? "Save changes" : "Add memory"}
              disabled={!canSubmit}
              onPress={() => void submit()}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: colors.primary,
                  borderColor: "transparent",
                  borderRadius: radii.md,
                  opacity: !canSubmit ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {pending ? (
                <ActivityIndicator
                  color={colors.primaryForeground}
                  size="small"
                />
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
                  {memory ? "Save changes" : "Add memory"}
                </Text>
              )}
            </Pressable>
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    );
  },
);

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  title: { fontSize: 18, paddingHorizontal: 4 },
  subtitle: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  field: { gap: 6 },
  label: { fontSize: 13 },
  valueInput: {
    minHeight: 100,
    maxHeight: 160,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  keyInput: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  hint: { fontSize: 12, lineHeight: 17 },
  error: { fontSize: 12, lineHeight: 17 },
  actions: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    marginTop: 2,
  },
  button: {
    minWidth: 96,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: { fontSize: 14 },
});
