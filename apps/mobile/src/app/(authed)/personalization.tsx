import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import {
  ABOUT_MAX_LENGTH,
  OCCUPATION_MAX_LENGTH,
  PREFERRED_NAME_MAX_LENGTH,
  type Memory,
  type Personalization,
  type PersonalizationSnapshot,
} from "@overtchat/shared";
import { Stack } from "expo-router";
import { useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  MemoryEditorSheet,
  type MemoryEditorSheetRef,
} from "@/components/personalization/MemoryEditorSheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import {
  useClearMemories,
  useDeleteMemory,
  usePersonalization,
  useUpdatePersonalization,
} from "@/lib/queries/personalization";
import { getServerUrl } from "@/lib/server-url";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";

export default function PersonalizationScreen() {
  const { colors, fonts } = useTheme();
  const personalization = usePersonalization();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <Text
              style={{
                color: colors.foreground,
                fontFamily: fonts.serifSemiBold,
                fontSize: 18,
              }}
            >
              Personalization
            </Text>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Settings",
        }}
      />
      <KeyboardAvoidingView
        style={[styles.root, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView
          style={styles.root}
          edges={["bottom", "left", "right"]}
        >
          {personalization.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.mutedForeground} />
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                }}
              >
                Loading personalization…
              </Text>
            </View>
          ) : personalization.error || !personalization.data ? (
            <LoadError
              message={
                personalization.error?.message ??
                "Unable to load personalization."
              }
              onRetry={() => void personalization.refetch()}
            />
          ) : (
            <PersonalizationContent
              data={personalization.data}
              refreshing={personalization.isRefetching}
              onRefresh={() => void personalization.refetch()}
            />
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </>
  );
}

function PersonalizationContent({
  data,
  refreshing,
  onRefresh,
}: {
  data: PersonalizationSnapshot;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.mutedForeground}
        />
      }
    >
      <View style={styles.pageHeader}>
        <Text
          style={[
            styles.pageDescription,
            {
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
            },
          ]}
        >
          Tell OvertChat about you and manage what it remembers between chats.
        </Text>
      </View>
      <ProfileEditor personalization={data.personalization} />
      <MemoryManager memories={data.memories} usage={data.contextUsage} />
    </ScrollView>
  );
}

function ProfileEditor({
  personalization,
}: {
  personalization: Personalization;
}) {
  const { colors, radii, fonts } = useTheme();
  const updatePersonalization = useUpdatePersonalization();
  const nextBaseline = JSON.stringify(personalization);
  const [baseline, setBaseline] = useState(nextBaseline);
  const [enabled, setEnabled] = useState(personalization.enabled);
  const [preferredName, setPreferredName] = useState(
    personalization.preferredName ?? "",
  );
  const [occupation, setOccupation] = useState(
    personalization.occupation ?? "",
  );
  const [about, setAbout] = useState(personalization.about ?? "");
  const [error, setError] = useState("");

  if (baseline !== nextBaseline) {
    setBaseline(nextBaseline);
    setEnabled(personalization.enabled);
    setPreferredName(personalization.preferredName ?? "");
    setOccupation(personalization.occupation ?? "");
    setAbout(personalization.about ?? "");
  }

  const changed =
    enabled !== personalization.enabled ||
    preferredName.trim() !== (personalization.preferredName ?? "") ||
    occupation.trim() !== (personalization.occupation ?? "") ||
    about.trim() !== (personalization.about ?? "");

  async function save() {
    setError("");
    try {
      await updatePersonalization.mutateAsync({
        enabled,
        preferredName,
        occupation,
        about,
      });
      toastSuccess("Personalization saved");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn't save personalization.",
      );
    }
  }

  return (
    <Section
      title="About you"
      description="Empty fields are not added to model context."
    >
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text
            style={[
              styles.rowLabel,
              { color: colors.foreground, fontFamily: fonts.sansRegular },
            ]}
          >
            Use personalization
          </Text>
          <Text
            style={[
              styles.rowSub,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            Include your profile and memories in chats, and allow models to
            manage memory when asked. Temporary chats never use it.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Use personalization"
          value={enabled}
          onValueChange={(next) => {
            setEnabled(next);
            setError("");
          }}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.background}
        />
      </View>
      <Divider />
      <ProfileField
        label="Preferred name"
        description="What should OvertChat call you?"
        value={preferredName}
        onChangeText={(next) => {
          setPreferredName(next);
          setError("");
        }}
        maxLength={PREFERRED_NAME_MAX_LENGTH}
        placeholder="Optional"
      />
      <Divider />
      <ProfileField
        label="Occupation"
        value={occupation}
        onChangeText={(next) => {
          setOccupation(next);
          setError("");
        }}
        maxLength={OCCUPATION_MAX_LENGTH}
        placeholder="Optional"
      />
      <Divider />
      <ProfileField
        label="More about you"
        description="Interests, values, or preferences to keep in mind."
        value={about}
        onChangeText={(next) => {
          setAbout(next);
          setError("");
        }}
        maxLength={ABOUT_MAX_LENGTH}
        placeholder="Optional"
        multiline
      />
      {error ? (
        <>
          <Divider />
          <Text
            accessibilityRole="alert"
            style={[
              styles.inlineError,
              { color: colors.destructive, fontFamily: fonts.sansRegular },
            ]}
          >
            {error}
          </Text>
        </>
      ) : null}
      <Divider />
      <View style={styles.actionsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save personalization"
          disabled={!changed || updatePersonalization.isPending}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: colors.primary,
              borderRadius: radii.md,
              opacity:
                !changed || updatePersonalization.isPending
                  ? 0.4
                  : pressed
                    ? 0.85
                    : 1,
            },
          ]}
        >
          {updatePersonalization.isPending ? (
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
    </Section>
  );
}

function ProfileField({
  label,
  description,
  value,
  onChangeText,
  maxLength,
  placeholder,
  multiline = false,
}: {
  label: string;
  description?: string;
  value: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  placeholder: string;
  multiline?: boolean;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.fieldRow}>
      <View style={styles.fieldHeader}>
        <Text
          style={[
            styles.rowLabel,
            { color: colors.foreground, fontFamily: fonts.sansRegular },
          ]}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[
              styles.rowSub,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          multiline ? styles.multilineInput : styles.input,
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
  );
}

function MemoryManager({
  memories,
  usage,
}: {
  memories: Memory[];
  usage: PersonalizationSnapshot["contextUsage"];
}) {
  const { colors, radii, fonts } = useTheme();
  const editorRef = useRef<MemoryEditorSheetRef>(null);
  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const clearSheetRef = useRef<BottomSheetModal>(null);
  const deleteMemory = useDeleteMemory();
  const clearMemories = useClearMemories();
  const [memoryQuery, setMemoryQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);
  const normalizedQuery = memoryQuery.trim().toLocaleLowerCase();
  const filteredMemories = normalizedQuery
    ? memories.filter(
        (memory) =>
          memory.key.toLocaleLowerCase().includes(normalizedQuery) ||
          memory.value.toLocaleLowerCase().includes(normalizedQuery),
      )
    : memories;
  const usagePercent = Math.min(
    100,
    Math.round(
      Math.max(usage.bytes / usage.limit, usage.entries / usage.entryLimit) *
        100,
    ),
  );

  function requestDelete(memory: Memory) {
    setDeleteTarget(memory);
    requestAnimationFrame(() => deleteSheetRef.current?.present());
  }

  function confirmDelete() {
    if (!deleteTarget || deleteMemory.isPending) return;
    deleteMemory.mutate(deleteTarget.id, {
      onSuccess: () => {
        toastSuccess("Memory deleted");
        setDeleteTarget(null);
      },
      onError: (error) => toastError("Couldn't delete memory", error),
    });
  }

  function confirmClear() {
    if (clearMemories.isPending) return;
    clearMemories.mutate(undefined, {
      onSuccess: () => toastSuccess("Memories cleared"),
      onError: (error) => toastError("Couldn't clear memories", error),
    });
  }

  return (
    <>
      <Section
        title="Saved memories"
        description="Models can change these entries when you explicitly ask them to remember or forget something. Your profile and memories share a 4 KiB context budget."
      >
        <View style={styles.memoryToolbar}>
          <View
            accessibilityLabel={`${usagePercent}% used, ${usage.bytes} of ${usage.limit} context bytes, ${usage.entries} of ${usage.entryLimit} memories`}
            style={[
              styles.usagePill,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                borderRadius: radii.pill,
              },
            ]}
          >
            <Text
              style={[
                styles.usageText,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansMedium,
                },
              ]}
            >
              {usagePercent}% used
            </Text>
          </View>
          <View style={styles.memoryToolbarActions}>
            {memories.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all memories"
                onPress={() => clearSheetRef.current?.present()}
                style={({ pressed }) => [
                  styles.compactButton,
                  {
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.compactButtonText,
                    {
                      color: colors.foreground,
                      fontFamily: fonts.sansMedium,
                    },
                  ]}
                >
                  Clear all
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add memory"
              onPress={() => editorRef.current?.present()}
              style={({ pressed }) => [
                styles.compactButton,
                {
                  backgroundColor: colors.primary,
                  borderColor: "transparent",
                  borderRadius: radii.md,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons
                name="add"
                size={16}
                color={colors.primaryForeground}
              />
              <Text
                style={[
                  styles.compactButtonText,
                  {
                    color: colors.primaryForeground,
                    fontFamily: fonts.sansMedium,
                  },
                ]}
              >
                Add
              </Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.usageTrack}>
          <View
            style={[
              styles.usageTrackBackground,
              { backgroundColor: colors.muted },
            ]}
          >
            <View
              style={[
                styles.usageTrackFill,
                {
                  backgroundColor: colors.primary,
                  width: `${usagePercent}%`,
                },
              ]}
            />
          </View>
          <Text
            style={[
              styles.usageDetail,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {usage.bytes.toLocaleString()} of {usage.limit.toLocaleString()} bytes
            · {usage.entries} of {usage.entryLimit} memories
          </Text>
        </View>

        {memories.length >= 5 || memoryQuery ? (
          <View style={styles.searchWrap}>
            <Ionicons
              name="search-outline"
              size={17}
              color={colors.mutedForeground}
              style={styles.searchIcon}
            />
            <TextInput
              accessibilityLabel="Search memories"
              value={memoryQuery}
              onChangeText={setMemoryQuery}
              placeholder="Search memories"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              style={[
                styles.searchInput,
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
        ) : null}

        {memories.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name="sparkles-outline"
              size={24}
              color={colors.mutedForeground}
            />
            <Text
              style={[
                styles.emptyTitle,
                { color: colors.foreground, fontFamily: fonts.sansMedium },
              ]}
            >
              Nothing remembered yet
            </Text>
            <Text
              style={[
                styles.emptyDescription,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              Ask OvertChat to remember something, or add it manually.
            </Text>
          </View>
        ) : filteredMemories.length === 0 ? (
          <View style={styles.emptyState}>
            <Text
              style={[
                styles.emptyDescription,
                {
                  color: colors.mutedForeground,
                  fontFamily: fonts.sansRegular,
                },
              ]}
            >
              No memories match “{memoryQuery.trim()}”.
            </Text>
          </View>
        ) : (
          <View style={styles.memoryList}>
            {filteredMemories.map((memory, index) => (
              <View key={memory.id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.memoryRow}>
                  <View
                    style={[
                      styles.memoryIcon,
                      {
                        backgroundColor: colors.muted,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Ionicons
                      name="sparkles-outline"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </View>
                  <View style={styles.memoryText}>
                    <Text
                      style={[
                        styles.memoryValue,
                        {
                          color: colors.foreground,
                          fontFamily: fonts.sansRegular,
                        },
                      ]}
                    >
                      {memory.value}
                    </Text>
                    <Text
                      style={[
                        styles.memoryMeta,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.mono,
                        },
                      ]}
                    >
                      {memory.key}
                    </Text>
                    <Text
                      style={[
                        styles.memoryDate,
                        {
                          color: colors.mutedForeground,
                          fontFamily: fonts.sansRegular,
                        },
                      ]}
                    >
                      Updated {new Date(memory.updatedAt).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.memoryActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${memory.key}`}
                      hitSlop={8}
                      onPress={() => editorRef.current?.present(memory)}
                      style={({ pressed }) => [
                        styles.iconButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Ionicons
                        name="pencil-outline"
                        size={19}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${memory.key}`}
                      hitSlop={8}
                      onPress={() => requestDelete(memory)}
                      style={({ pressed }) => [
                        styles.iconButton,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={19}
                        color={colors.destructive}
                      />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>

      <MemoryEditorSheet ref={editorRef} />
      <ConfirmSheet
        ref={deleteSheetRef}
        title="Delete this memory?"
        message="OvertChat will no longer include it in future conversations."
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
      <ConfirmSheet
        ref={clearSheetRef}
        title="Clear all memories?"
        message="This permanently deletes every saved memory. Your profile fields are not affected."
        confirmLabel="Clear all"
        destructive
        onConfirm={confirmClear}
      />
    </>
  );
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons name="alert-circle-outline" size={28} color={colors.destructive} />
      <Text
        accessibilityRole="alert"
        style={[
          styles.loadError,
          { color: colors.foreground, fontFamily: fonts.sansRegular },
        ]}
      >
        {message}
      </Text>
      <View style={styles.errorActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.errorButton,
            {
              backgroundColor: colors.primary,
              borderColor: "transparent",
              borderRadius: radii.md,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text
            style={[
              styles.buttonText,
              {
                color: colors.primaryForeground,
                fontFamily: fonts.sansSemiBold,
              },
            ]}
          >
            Retry
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          onPress={() => openOnWeb("/settings/personalization")}
          style={({ pressed }) => [
            styles.errorButton,
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
            Open on web
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { colors, radii, fonts } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionTitle,
            { color: colors.foreground, fontFamily: fonts.sansSemiBold },
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              styles.sectionDescription,
              {
                color: colors.mutedForeground,
                fontFamily: fonts.sansRegular,
              },
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.sectionBody,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.lg,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

function openOnWeb(path: string) {
  const serverUrl = getServerUrl();
  if (!serverUrl) return;
  Linking.openURL(`${serverUrl.replace(/\/$/, "")}${path}`).catch(() => {});
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 28,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 24,
  },
  pageHeader: { paddingHorizontal: 4 },
  pageDescription: { fontSize: 13, lineHeight: 19 },
  section: { gap: 10 },
  sectionHeader: { gap: 3, paddingHorizontal: 4 },
  sectionTitle: { fontSize: 15 },
  sectionDescription: { fontSize: 12, lineHeight: 18 },
  sectionBody: {
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  rowText: { flex: 1, gap: 3 },
  rowLabel: { fontSize: 15 },
  rowSub: { fontSize: 12, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth },
  fieldRow: { gap: 8, paddingHorizontal: 14, paddingVertical: 13 },
  fieldHeader: { gap: 3 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  multilineInput: {
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineError: { fontSize: 12, lineHeight: 17, padding: 14 },
  actionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 12,
  },
  primaryButton: {
    minWidth: 96,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  buttonText: { fontSize: 14 },
  memoryToolbar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  memoryToolbarActions: { flexDirection: "row", gap: 8 },
  usagePill: {
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  usageText: { fontSize: 12 },
  compactButton: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  compactButtonText: { fontSize: 12 },
  usageTrack: { gap: 7, paddingHorizontal: 14, paddingVertical: 12 },
  usageTrackBackground: { height: 5, borderRadius: 3, overflow: "hidden" },
  usageTrackFill: { height: "100%", borderRadius: 3 },
  usageDetail: { fontSize: 11, lineHeight: 16 },
  searchWrap: {
    position: "relative",
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  searchIcon: { position: "absolute", left: 25, top: 12, zIndex: 1 },
  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 14,
    paddingLeft: 36,
    paddingRight: 12,
    paddingVertical: 9,
  },
  emptyState: {
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: 24,
  },
  emptyTitle: { fontSize: 14 },
  emptyDescription: { fontSize: 12, lineHeight: 18, textAlign: "center" },
  memoryList: { paddingHorizontal: 14, paddingBottom: 4 },
  memoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 13,
  },
  memoryIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  memoryText: { flex: 1, gap: 3 },
  memoryValue: { fontSize: 14, lineHeight: 20 },
  memoryMeta: { fontSize: 11 },
  memoryDate: { fontSize: 11 },
  memoryActions: { flexDirection: "row", gap: 3 },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  loadError: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  errorActions: { flexDirection: "row", gap: 8 },
  errorButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
