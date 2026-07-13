import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useChatSession } from "@/lib/chat/session";
import { useChats } from "@/lib/queries/chats";
import {
  useDeleteProject,
  useProject,
  useUpdateProject,
} from "@/lib/queries/projects";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";

export default function ProjectScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = params.id;
  if (!id) {
    return null;
  }
  return <ProjectScreenInner projectId={id} />;
}

function ProjectScreenInner({ projectId }: { projectId: string }) {
  const { colors, radii, fonts } = useTheme();
  const { startNewChat, openChat } = useChatSession();

  const { data: project, isPending, error } = useProject(projectId);
  const { data: chats } = useChats();
  const updateMutation = useUpdateProject(projectId);
  const deleteMutation = useDeleteProject();

  const deleteSheetRef = useRef<BottomSheetModal>(null);

  const savedInstructions = project?.instructions ?? "";
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null);

  // Reset the draft when the saved value changes (after save / project switch).
  // Mirrors the pattern in the web app's ProjectPanel.
  const [draftBaseline, setDraftBaseline] = useState(savedInstructions);
  if (savedInstructions !== draftBaseline) {
    setDraftBaseline(savedInstructions);
    setInstructionsDraft(null);
  }

  const instructions = instructionsDraft ?? savedInstructions;
  const dirty =
    instructionsDraft !== null && instructionsDraft !== savedInstructions;

  const projectChats = useMemo(
    () => (chats ?? []).filter((c) => c.projectId === projectId),
    [chats, projectId],
  );

  function startRename() {
    if (!project) return;
    setNameDraft(project.name);
    setRenaming(true);
  }

  function commitRename() {
    setRenaming(false);
    if (!project) return;
    const next = nameDraft.trim();
    if (!next || next === project.name) return;
    updateMutation.mutate(
      { name: next },
      {
        onSuccess: () => toastSuccess("Renamed"),
        onError: (e) => toastError("Couldn't rename project", e),
      },
    );
  }

  function saveInstructions() {
    if (instructionsDraft === null) return;
    const value = instructionsDraft;
    updateMutation.mutate(
      { instructions: value.trim() ? value : null },
      {
        onSuccess: () => {
          toastSuccess("Saved");
          setInstructionsDraft(null);
        },
        onError: (e) => toastError("Couldn't save instructions", e),
      },
    );
  }

  function confirmDelete() {
    if (!project) return;
    deleteMutation.mutate(project.id, {
      onSuccess: () => {
        toastSuccess("Project deleted");
        router.replace("/chat");
      },
      onError: (e) => toastError("Couldn't delete project", e),
    });
  }

  function handleNewChat() {
    startNewChat(projectId);
    router.push("/chat");
  }

  function handleOpenChat(chatId: string) {
    openChat(chatId);
    router.push("/chat");
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: () => (
            <Text
              numberOfLines={1}
              style={{
                color: colors.foreground,
                fontFamily: fonts.serifSemiBold,
                fontSize: 18,
                maxWidth: 220,
              }}
            >
              {project?.name ?? "Project"}
            </Text>
          ),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Back",
          headerRight: () =>
            project ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete project"
                onPress={() => deleteSheetRef.current?.present()}
                hitSlop={10}
                style={styles.headerBtn}
              >
                <Ionicons
                  name="trash-outline"
                  size={20}
                  color={colors.foreground}
                />
              </Pressable>
            ) : null,
        }}
      />

      <KeyboardAvoidingView
        style={[styles.kav, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView
          style={styles.root}
          edges={["bottom", "left", "right"]}
        >
          {isPending ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.mutedForeground} />
            </View>
          ) : error || !project ? (
            <View style={styles.center}>
              <Text
                style={[
                  styles.errorText,
                  { color: colors.destructive, fontFamily: fonts.sansRegular },
                ]}
              >
                {error?.message || "Project not found"}
              </Text>
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              {/* Name */}
              <View style={styles.section}>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
                  ]}
                >
                  NAME
                </Text>
                {renaming ? (
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    autoFocus
                    onBlur={commitRename}
                    onSubmitEditing={commitRename}
                    returnKeyType="done"
                    maxLength={120}
                    style={[
                      styles.nameInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.muted,
                        borderRadius: radii.md,
                        fontFamily: fonts.sansRegular,
                      },
                    ]}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Rename project"
                    onPress={startRename}
                    style={({ pressed }) => [
                      styles.nameDisplay,
                      {
                        backgroundColor: pressed ? colors.muted : colors.card,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.nameText,
                        { color: colors.foreground, fontFamily: fonts.sansRegular },
                      ]}
                    >
                      {project.name}
                    </Text>
                    <Ionicons
                      name="pencil-outline"
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                )}
              </View>

              {/* Instructions */}
              <View style={styles.section}>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
                  ]}
                >
                  INSTRUCTIONS
                </Text>
                <Text
                  style={[
                    styles.help,
                    { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                  ]}
                >
                  Prepended to every chat in this project.
                </Text>
                <TextInput
                  value={instructions}
                  onChangeText={setInstructionsDraft}
                  placeholder="e.g. Always respond in concise bullet points. Assume the reader is a senior engineer."
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.instructionsInput,
                    {
                      color: colors.foreground,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                      fontFamily: fonts.sansRegular,
                    },
                  ]}
                />
                <View style={styles.saveRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save instructions"
                    onPress={saveInstructions}
                    disabled={!dirty || updateMutation.isPending}
                    style={({ pressed }) => [
                      styles.saveBtn,
                      {
                        backgroundColor: colors.primary,
                        borderRadius: radii.md,
                        opacity:
                          !dirty || updateMutation.isPending
                            ? 0.4
                            : pressed
                              ? 0.85
                              : 1,
                      },
                    ]}
                  >
                    {updateMutation.isPending ? (
                      <ActivityIndicator
                        color={colors.primaryForeground}
                        size="small"
                      />
                    ) : (
                      <Text
                        style={[
                          styles.saveBtnText,
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
              </View>

              {/* Chats */}
              <View style={styles.section}>
                <View style={styles.chatsHeader}>
                  <Text
                    style={[
                      styles.sectionLabel,
                      {
                        color: colors.mutedForeground,
                        fontFamily: fonts.sansMedium,
                      },
                    ]}
                  >
                    CHATS
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="New chat in this project"
                    onPress={handleNewChat}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.newChatBtn,
                      {
                        backgroundColor: pressed ? colors.muted : colors.card,
                        borderColor: colors.border,
                        borderRadius: radii.md,
                      },
                    ]}
                  >
                    <Ionicons name="add" size={16} color={colors.foreground} />
                    <Text
                      style={[
                        styles.newChatText,
                        {
                          color: colors.foreground,
                          fontFamily: fonts.sansSemiBold,
                        },
                      ]}
                    >
                      New chat
                    </Text>
                  </Pressable>
                </View>
                {projectChats.length === 0 ? (
                  <Text
                    style={[
                      styles.help,
                      {
                        color: colors.mutedForeground,
                        fontFamily: fonts.sansRegular,
                      },
                    ]}
                  >
                    No chats yet. Tap "New chat" to start one in this project.
                  </Text>
                ) : (
                  <View
                    style={[
                      styles.chatList,
                      {
                        borderColor: colors.border,
                        borderRadius: radii.md,
                        backgroundColor: colors.card,
                      },
                    ]}
                  >
                    {projectChats.map((c, idx) => (
                      <Pressable
                        key={c.id}
                        accessibilityRole="button"
                        onPress={() => handleOpenChat(c.id)}
                        style={({ pressed }) => [
                          styles.chatRow,
                          idx > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                          },
                          { backgroundColor: pressed ? colors.muted : "transparent" },
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.chatRowText,
                            {
                              color: colors.foreground,
                              fontFamily: fonts.sansRegular,
                            },
                          ]}
                        >
                          {c.title?.trim() || "Untitled"}
                        </Text>
                        <Ionicons
                          name="chevron-forward"
                          size={16}
                          color={colors.mutedForeground}
                        />
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>

      <ConfirmSheet
        ref={deleteSheetRef}
        title="Delete project?"
        message={
          project
            ? `${project.name} will be deleted. Chats inside it will move to your main list.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, textAlign: "center" },
  content: { padding: 16, gap: 24, paddingBottom: 48 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
  },
  help: { fontSize: 13 },
  nameInput: {
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  nameDisplay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  nameText: { fontSize: 16, flex: 1 },
  instructionsInput: {
    fontSize: 14,
    minHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveRow: { flexDirection: "row", justifyContent: "flex-end" },
  saveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    minWidth: 88,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 14 },
  chatsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  newChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newChatText: { fontSize: 13 },
  chatList: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chatRowText: { fontSize: 14, flex: 1, marginRight: 8 },
  headerBtn: { paddingHorizontal: 12 },
});
