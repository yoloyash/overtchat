import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { Memory, PersonalizationSnapshot } from "@overtchat/shared";
import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import {
  useClearMemories,
  useDeleteMemory,
} from "@/lib/queries/personalization";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import {
  MemoryEditorSheet,
  type MemoryEditorSheetRef,
} from "./MemoryEditorSheet";
import {
  PersonalizationDivider,
  PersonalizationSection,
} from "./PersonalizationSection";

export function MemoryManager({
  memories,
  usage,
}: {
  memories: Memory[];
  usage: PersonalizationSnapshot["contextUsage"];
}) {
  const { colors, radii, fonts } = useTheme();
  const { t } = useTranslation();
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
        toastSuccess(t("personalization.memories.deleteDialog.deletedToast"));
        setDeleteTarget(null);
      },
      onError: (error) => toastError(t("personalization.mobile.memories.deleteError"), error),
    });
  }

  function confirmClear() {
    if (clearMemories.isPending) return;
    clearMemories.mutate(undefined, {
      onSuccess: () => toastSuccess(t("personalization.memories.clearedToast")),
      onError: (error) => toastError(t("personalization.mobile.memories.clearError"), error),
    });
  }

  return (
    <>
      <PersonalizationSection
        title={t("personalization.memories.title")}
        description={t("personalization.mobile.memories.description")}
      >
        <View style={styles.memoryToolbar}>
          <View
            accessibilityLabel={t("personalization.mobile.memories.usageAccessibility", {
              percent: usagePercent,
              bytes: usage.bytes,
              limit: usage.limit,
              entries: usage.entries,
              entryLimit: usage.entryLimit,
            })}
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
              {t("personalization.memories.usageBadge", { percent: usagePercent })}
            </Text>
          </View>
          <View style={styles.memoryToolbarActions}>
            {memories.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("personalization.mobile.memories.clearAllLabel")}
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
                  {t("personalization.memories.clearDialog.trigger")}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("personalization.memories.add")}
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
                {t("personalization.mobile.memories.addShort")}
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
            {t("personalization.mobile.memories.usageDetail", {
              bytes: usage.bytes.toLocaleString(),
              limit: usage.limit.toLocaleString(),
              entries: usage.entries,
              entryLimit: usage.entryLimit,
            })}
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
              accessibilityLabel={t("personalization.memories.searchPlaceholder")}
              value={memoryQuery}
              onChangeText={setMemoryQuery}
              placeholder={t("personalization.memories.searchPlaceholder")}
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
              {t("personalization.memories.emptyTitle")}
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
              {t("personalization.memories.emptyDescription")}
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
              {t("personalization.mobile.memories.noMatches", {
                query: memoryQuery.trim(),
              })}
            </Text>
          </View>
        ) : (
          <View style={styles.memoryList}>
            {filteredMemories.map((memory, index) => (
              <View key={memory.id}>
                {index > 0 ? <PersonalizationDivider /> : null}
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
                      {t("personalization.memories.updated", {
                        date: new Date(memory.updatedAt).toLocaleDateString(),
                      })}
                    </Text>
                  </View>
                  <View style={styles.memoryActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("personalization.memories.editAriaLabel", {
                        key: memory.key,
                      })}
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
                      accessibilityLabel={t("personalization.memories.deleteDialog.ariaLabel", {
                        key: memory.key,
                      })}
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
      </PersonalizationSection>

      <MemoryEditorSheet ref={editorRef} />
      <ConfirmSheet
        ref={deleteSheetRef}
        title={t("personalization.memories.deleteDialog.title")}
        message={t("personalization.memories.deleteDialog.description")}
        confirmLabel={t("personalization.memories.deleteDialog.confirm")}
        destructive
        onConfirm={confirmDelete}
      />
      <ConfirmSheet
        ref={clearSheetRef}
        title={t("personalization.memories.clearDialog.title")}
        message={t("personalization.memories.clearDialog.description")}
        confirmLabel={t("personalization.memories.clearDialog.confirm")}
        destructive
        onConfirm={confirmClear}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
});
