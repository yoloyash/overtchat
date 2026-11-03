import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  agentProviderMetadata,
  type AgentProviderId,
} from "@overtchat/agent-bridge";
import { SelectionSheet } from "@/components/ui/SelectionSheet";
import {
  agentSetupAgentsForWorkspace,
  agentSetupForWorkspace,
  agentSetupHosts,
  agentSetupWorkspaces,
  type AgentSetup,
  type AgentSetupAgent,
} from "@/lib/agents/setups";
import { useAgentProviderSnapshot } from "@/lib/queries/agents";
import { useTheme } from "@/lib/theme";
import { AgentProviderIcon } from "./AgentProviderIcon";

export type AgentSetupPickerPanel = "host" | "workspace" | "agent";

/** The setup a new session moves to when a pill changes. */
export type AgentSetupChange = Pick<AgentSetupAgent, "workspaceId" | "provider">;

/**
 * Switches a new session to another machine, a folder on it, then any agent
 * the machine has, through borderless pills that open selection sheets. The
 * machine is only offered when there is more than one. Every list is ordered
 * by last use, as on the web.
 */
export function AgentSetupPicker({
  setups: allSetups,
  workspaceId,
  provider,
  lockedProvider = null,
  open,
  onOpen,
  onChange,
}: {
  setups: AgentSetup[];
  workspaceId: string;
  provider: AgentProviderId;
  /** Keep this agent and offer only its machines and folders. */
  lockedProvider?: AgentProviderId | null;
  /** The sheet currently open, if any. */
  open: AgentSetupPickerPanel | null;
  onOpen: (panel: AgentSetupPickerPanel | null) => void;
  onChange: (setup: AgentSetupChange) => void;
}) {
  const { colors, fonts, radii } = useTheme();
  const setups = lockedProvider
    ? allSetups.filter((setup) => setup.provider === lockedProvider)
    : allSetups;
  const current = setups.find((setup) => setup.workspaceId === workspaceId);
  // A locked agent needs no detection: it only moves between its own folders.
  const snapshot = useAgentProviderSnapshot(
    lockedProvider ? null : (current?.target ?? null),
  ).data;
  if (!current) return null;
  const hosts = agentSetupHosts(setups);
  const workspaces = agentSetupWorkspaces(setups, current.hostKey);
  const agents = agentSetupAgentsForWorkspace(
    setups,
    current.hostKey,
    current.workspacePath,
    snapshot,
  ).filter((agent) => agent.detected);

  function pick(agent: AgentSetupChange | undefined) {
    onOpen(null);
    if (
      !agent ||
      (agent.workspaceId === workspaceId && agent.provider === provider)
    ) {
      return;
    }
    onChange(agent);
  }

  const pill = ({ pressed }: { pressed: boolean }) => [
    styles.pill,
    {
      borderRadius: radii.pill,
      backgroundColor: pressed ? colors.muted : "transparent",
    },
  ];
  const pillText = [
    styles.pillText,
    { color: colors.mutedForeground, fontFamily: fonts.sansMedium },
  ];

  return (
    <View style={styles.row}>
      {hosts.length > 1 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Machine: ${current.hostLabel}`}
          onPress={() => onOpen("host")}
          style={pill}
        >
          {/* The marks the connection settings use: this server, or over SSH. */}
          <Ionicons
            name={current.transport === "ssh" ? "wifi-outline" : "server-outline"}
            size={14}
            color={colors.mutedForeground}
          />
          <Text numberOfLines={1} style={pillText}>
            {current.hostLabel}
          </Text>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace: ${current.workspaceName}`}
        onPress={() => onOpen("workspace")}
        style={pill}
      >
        <Ionicons name="folder-outline" size={14} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={pillText}>
          {current.workspaceName}
        </Text>
      </Pressable>
      {!lockedProvider && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Agent: ${agentProviderMetadata(provider).label}`}
          onPress={() => onOpen("agent")}
          style={pill}
        >
          <AgentProviderIcon provider={provider} size={14} />
          <Text numberOfLines={1} style={pillText}>
            {agentProviderMetadata(provider).label}
          </Text>
        </Pressable>
      )}
      <SelectionSheet
        title="Machine"
        visible={open === "host"}
        value={current.hostKey}
        options={hosts.map((host) => ({ value: host.hostKey, label: host.hostLabel }))}
        onClose={() => onOpen(null)}
        // A machine opens with the folder and agent last used on it.
        onSelect={(hostKey) => pick(agentSetupWorkspaces(setups, hostKey)[0])}
      />
      <SelectionSheet
        title="Workspace"
        visible={open === "workspace"}
        value={current.workspacePath}
        options={workspaces.map((workspace) => ({
          value: workspace.workspacePath,
          // Two folders with one name tell apart by path.
          label: workspaces.some(
            (other) =>
              other !== workspace && other.workspaceName === workspace.workspaceName,
          )
            ? `${workspace.workspaceName} · ${workspace.workspacePath}`
            : workspace.workspaceName,
        }))}
        onClose={() => onOpen(null)}
        // The agent stays if the machine has it; otherwise the folder's last-used agent.
        onSelect={(path) =>
          pick(
            agentSetupForWorkspace(setups, current.hostKey, path, provider, snapshot),
          )
        }
      />
      <SelectionSheet
        title="Agent"
        visible={open === "agent"}
        value={provider}
        options={agents.map((agent) => ({
          value: agent.provider,
          label: agentProviderMetadata(agent.provider).label,
          leading: <AgentProviderIcon provider={agent.provider} size={22} />,
        }))}
        onClose={() => onOpen(null)}
        onSelect={(id) => pick(agents.find((agent) => agent.provider === id))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 32,
    maxWidth: "100%",
    paddingHorizontal: 10,
    flexShrink: 1,
  },
  pillText: { fontSize: 13, flexShrink: 1 },
});
