import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { useTheme } from "@/lib/theme";
import { sessionTitle, type WorkspaceSession } from "@/lib/agents/workspaces";
import { useAgentGitStatus } from "@/lib/queries/agents";
import { AgentWorkingIndicator } from "./AgentWorkingIndicator";
import { AgentProviderIcon } from "./AgentProviderIcon";

export function AgentSearch({
  value,
  onChangeText,
  placeholder = "Search workspaces and chats",
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
}) {
  const { colors, fonts } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: colors.muted,
        borderRadius: 12,
        marginHorizontal: 16,
        marginVertical: 12,
        paddingHorizontal: 12,
      }}
    >
      <Ionicons
        name="search-outline"
        size={18}
        color={colors.mutedForeground}
      />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        autoCapitalize="none"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          color: colors.foreground,
          fontFamily: fonts.sansRegular,
          fontSize: 15,
        }}
      />
      {!!value && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
          hitSlop={10}
          style={{ padding: 8 }}
        >
          <Ionicons
            name="close-circle"
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
      )}
    </View>
  );
}

export function AgentSessionRow({
  item,
  workspaceName,
}: {
  item: WorkspaceSession;
  workspaceName: string;
}) {
  const { colors, fonts } = useTheme();
  const { session, provider, workspaceId } = item;
  const running = session.runtimeStatus === "running";
  const title = sessionTitle(session);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${agentProviderMetadata(provider).label}${running ? ", working" : ""}`}
      onPress={() =>
        router.push({
          pathname: "/agents/[id]",
          params: {
            id: session.id,
            workspace: workspaceId,
            name: workspaceName,
          },
        })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 13,
        minHeight: 64,
        borderRadius: 10,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <AgentProviderIcon provider={provider} size={24} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text
          numberOfLines={1}
          style={{
            color: colors.foreground,
            fontFamily: fonts.sansMedium,
            fontSize: 14,
          }}
        >
          {title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          {running && <AgentWorkingIndicator />}
          <Text
            numberOfLines={1}
            style={{
              color: colors.mutedForeground,
              fontFamily: fonts.sansRegular,
              fontSize: 12,
            }}
          >
            {running ? "Working" : agentProviderMetadata(provider).label}
            {session.modifiedAt
              ? ` · ${new Date(session.modifiedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
              : ""}
          </Text>
        </View>
      </View>
      <Ionicons
        name="chevron-forward"
        size={15}
        color={colors.mutedForeground}
      />
    </Pressable>
  );
}

export function AgentBranch({
  workspace,
  fallback,
}: {
  workspace: string;
  fallback?: string;
}) {
  const { colors, fonts } = useTheme();
  const query = useAgentGitStatus(workspace);
  if (
    query.isPending ||
    (!query.error && !query.data?.isGit) ||
    (query.error && fallback)
  )
    return fallback ? (
      <Text
        numberOfLines={1}
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.sansRegular,
          fontSize: 12,
          lineHeight: 16,
          flexShrink: 1,
        }}
      >
        {fallback}
      </Text>
    ) : null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        flexShrink: 1,
      }}
    >
      <Ionicons
        name="git-branch-outline"
        size={14}
        color={colors.mutedForeground}
      />
      <Text
        numberOfLines={1}
        style={{
          color: colors.mutedForeground,
          fontFamily: fonts.mono,
          fontSize: 12,
          flexShrink: 1,
        }}
      >
        {query.error
          ? "Git unavailable"
          : (query.data?.branch ?? "Detached HEAD")}
      </Text>
      {!query.error && query.data?.dirty && (
        <Ionicons
          accessibilityLabel="Uncommitted changes"
          name="ellipse"
          size={5}
          color={colors.mutedForeground}
        />
      )}
    </View>
  );
}
