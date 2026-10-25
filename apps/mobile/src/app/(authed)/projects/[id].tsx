import { Ionicons } from "@expo/vector-icons";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { formatUpdatedAt } from "@overtchat/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Popover, { PopoverPlacement } from "react-native-popover-view";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ProjectInstructionsSheet,
  type ProjectInstructionsSheetRef,
} from "@/components/projects/ProjectInstructionsSheet";
import {
  ProjectModelSheet,
  type ProjectModelSheetRef,
} from "@/components/projects/ProjectModelSheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { useChatSession } from "@/lib/chat/session";
import { useChats } from "@/lib/queries/chats";
import { useModelConfigs } from "@/lib/queries/modelConfigs";
import { useModelPreferences } from "@/lib/queries/modelPreferences";
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
  const { data: models } = useModelConfigs();
  const preferences = useModelPreferences();
  const updateMutation = useUpdateProject(projectId);
  const deleteMutation = useDeleteProject();

  const deleteSheetRef = useRef<BottomSheetModal>(null);
  const instructionsSheetRef = useRef<ProjectInstructionsSheetRef>(null);
  const modelSheetRef = useRef<ProjectModelSheetRef>(null);

  const menu = useMeasuredPopoverAnchor();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const projectChats = useMemo(
    () =>
      (chats ?? [])
        .filter((c) => c.projectId === projectId)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, projectId],
  );
  // Fixed per mount, like the rest of the list's data until it refreshes.
  const [now] = useState(() => Date.now());

  const projectDefault = models?.find((m) => m.id === project?.defaultModelId);
  // What new chats get without a project default.
  const accountDefault =
    models?.find((m) => m.id === preferences.data?.defaultModelId) ??
    models?.[0];
  const instructions = project?.instructions?.trim() ?? "";

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

  function selectDefaultModel(defaultModelId: string | null) {
    updateMutation.mutate(
      { defaultModelId },
      { onError: (e) => toastError("Couldn't change the default model", e) },
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

  const sectionLabel = [
    styles.sectionLabel,
    { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
  ];
  const group = [
    styles.group,
    {
      borderColor: colors.border,
      borderRadius: radii.lg,
      backgroundColor: colors.card,
    },
  ];
  const divider = {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: "",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
          headerBackTitle: "Back",
          headerRight: () =>
            project ? (
              <Pressable
                ref={menu.anchorRef}
                accessibilityRole="button"
                accessibilityLabel="Project actions"
                onPress={menu.open}
                hitSlop={10}
                style={styles.headerBtn}
              >
                <Ionicons
                  name="ellipsis-horizontal"
                  size={20}
                  color={colors.foreground}
                />
              </Pressable>
            ) : null,
        }}
      />
      {project && (
        <Popover
          from={menu.anchorRect ?? undefined}
          isVisible={menu.visible}
          onRequestClose={menu.close}
          placement={PopoverPlacement.BOTTOM}
          arrowSize={{ width: 0, height: 0 }}
          popoverStyle={{
            backgroundColor: colors.popover,
            borderRadius: radii.lg,
            borderColor: colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            paddingVertical: 4,
          }}
          backgroundStyle={{ backgroundColor: "rgba(0,0,0,0.15)" }}
        >
          <View style={styles.menu}>
            <MenuItem
              icon="pencil-outline"
              label="Rename"
              onPress={() => {
                menu.close();
                startRename();
              }}
            />
            <MenuItem
              icon="trash-outline"
              label="Delete project"
              destructive
              onPress={() => {
                menu.close();
                deleteSheetRef.current?.present();
              }}
            />
          </View>
        </Popover>
      )}

      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
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
            <View style={styles.hero}>
              <View
                style={[
                  styles.heroIcon,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.muted,
                    borderRadius: radii.lg,
                  },
                ]}
              >
                <Ionicons
                  name="folder-open-outline"
                  size={22}
                  color={colors.mutedForeground}
                />
              </View>
              <View style={styles.heroText}>
                {renaming ? (
                  <TextInput
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    autoFocus
                    onBlur={commitRename}
                    onSubmitEditing={commitRename}
                    returnKeyType="done"
                    maxLength={120}
                    accessibilityLabel="Project name"
                    style={[
                      styles.heroName,
                      styles.heroNameInput,
                      {
                        color: colors.foreground,
                        backgroundColor: colors.muted,
                        borderRadius: radii.md,
                        fontFamily: fonts.serifSemiBold,
                      },
                    ]}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${project.name}`}
                    onPress={startRename}
                  >
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.heroName,
                        {
                          color: colors.foreground,
                          fontFamily: fonts.serifSemiBold,
                        },
                      ]}
                    >
                      {project.name}
                    </Text>
                  </Pressable>
                )}
                <Text
                  style={[
                    styles.heroMeta,
                    { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                  ]}
                >
                  {projectChats.length === 1
                    ? "1 chat"
                    : `${projectChats.length} chats`}
                </Text>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`New chat in ${project.name}`}
              onPress={handleNewChat}
              style={({ pressed }) => [
                styles.newChat,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.muted : colors.card,
                  borderRadius: radii.xl,
                },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.newChatText,
                  { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                ]}
              >
                New chat in {project.name}
              </Text>
              <View
                style={[styles.newChatIcon, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="add" size={20} color={colors.primaryForeground} />
              </View>
            </Pressable>

            <View style={styles.section}>
              <Text style={sectionLabel}>SETTINGS</Text>
              <View style={group}>
                <SettingsRow
                  icon="document-text-outline"
                  title="Instructions"
                  detail={instructions || "Add context the model should always follow"}
                  detailLines={2}
                  onPress={() => instructionsSheetRef.current?.present()}
                />
                <View style={divider} />
                <SettingsRow
                  icon="sparkles-outline"
                  title="Default model"
                  detail={
                    projectDefault
                      ? projectDefault.label
                      : `Account default${accountDefault ? ` · ${accountDefault.label}` : ""}`
                  }
                  pending={updateMutation.isPending}
                  disabled={!models}
                  onPress={() => modelSheetRef.current?.present()}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={sectionLabel}>
                CHATS{projectChats.length > 0 ? ` · ${projectChats.length}` : ""}
              </Text>
              {projectChats.length === 0 ? (
                <View
                  style={[
                    styles.empty,
                    { borderColor: colors.border, borderRadius: radii.lg },
                  ]}
                >
                  <Ionicons
                    name="chatbubble-outline"
                    size={20}
                    color={colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.emptyTitle,
                      { color: colors.foreground, fontFamily: fonts.sansMedium },
                    ]}
                  >
                    No chats yet
                  </Text>
                  <Text
                    style={[
                      styles.emptyText,
                      { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
                    ]}
                  >
                    Chats here share this project&apos;s instructions and
                    default model.
                  </Text>
                </View>
              ) : (
                <View style={group}>
                  {projectChats.map((c, idx) => (
                    <Pressable
                      key={c.id}
                      accessibilityRole="button"
                      onPress={() => handleOpenChat(c.id)}
                      style={({ pressed }) => [
                        styles.chatRow,
                        idx > 0 && divider,
                        { backgroundColor: pressed ? colors.muted : "transparent" },
                      ]}
                    >
                      <View style={styles.chatRowText}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.chatTitle,
                            { color: colors.foreground, fontFamily: fonts.sansMedium },
                          ]}
                        >
                          {c.title?.trim() || "Untitled"}
                        </Text>
                        <Text
                          style={[
                            styles.chatMeta,
                            {
                              color: colors.mutedForeground,
                              fontFamily: fonts.sansRegular,
                            },
                          ]}
                        >
                          {formatUpdatedAt(c.updatedAt, now)}
                        </Text>
                      </View>
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

      {project && (
        <>
          <ProjectInstructionsSheet
            ref={instructionsSheetRef}
            project={project}
          />
          <ProjectModelSheet
            ref={modelSheetRef}
            models={models ?? []}
            selectedId={projectDefault?.id ?? null}
            accountDefault={accountDefault}
            onSelect={selectDefaultModel}
          />
        </>
      )}
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

function SettingsRow({
  icon,
  title,
  detail,
  detailLines = 1,
  pending = false,
  disabled = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  detail: string;
  detailLines?: number;
  pending?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingsRow,
        { backgroundColor: pressed ? colors.muted : "transparent" },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.mutedForeground} />
      <View style={styles.settingsRowText}>
        <Text
          style={[
            styles.settingsTitle,
            { color: colors.foreground, fontFamily: fonts.sansMedium },
          ]}
        >
          {title}
        </Text>
        <Text
          numberOfLines={detailLines}
          style={[
            styles.settingsDetail,
            { color: colors.mutedForeground, fontFamily: fonts.sansRegular },
          ]}
        >
          {detail}
        </Text>
      </View>
      {pending ? (
        <ActivityIndicator size="small" color={colors.mutedForeground} />
      ) : (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colors.mutedForeground}
        />
      )}
    </Pressable>
  );
}

function MenuItem({
  icon,
  label,
  destructive = false,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  const { colors, fonts } = useTheme();
  const tint = destructive ? colors.destructive : colors.popoverForeground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        { backgroundColor: pressed ? colors.muted : "transparent" },
      ]}
    >
      <Ionicons name={icon} size={17} color={tint} />
      <Text style={[styles.menuLabel, { color: tint, fontFamily: fonts.sansRegular }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { fontSize: 14, textAlign: "center" },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 24 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  heroText: { flex: 1, minWidth: 0, gap: 2 },
  heroName: { fontSize: 26, lineHeight: 32 },
  heroNameInput: { paddingHorizontal: 8, paddingVertical: 2 },
  heroMeta: { fontSize: 13 },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingLeft: 18,
    paddingRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  newChatText: { flex: 1, fontSize: 16 },
  newChatIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.6, paddingHorizontal: 4 },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
  },
  settingsRowText: { flex: 1, minWidth: 0, gap: 2 },
  settingsTitle: { fontSize: 15 },
  settingsDetail: { fontSize: 13, lineHeight: 18 },
  empty: {
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
  },
  emptyTitle: { fontSize: 14, marginTop: 4 },
  emptyText: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chatRowText: { flex: 1, minWidth: 0, gap: 2 },
  chatTitle: { fontSize: 15 },
  chatMeta: { fontSize: 12 },
  headerBtn: { paddingHorizontal: 12 },
  menu: { minWidth: 190 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  menuLabel: { fontSize: 15 },
});
