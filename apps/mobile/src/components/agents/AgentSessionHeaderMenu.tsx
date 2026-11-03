import { Keyboard, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { useTheme } from "@/lib/theme";
import { toastError, toastSuccess } from "@/lib/toast";
import { AgentMenu, type AgentMenuSection } from "./AgentMenu";

export type AgentSessionMenuInput = {
  /** Hidden for providers that cannot name sessions. */
  renameSupported: boolean;
  /** Connected to a writable session. */
  ready: boolean;
  /** The agent is working or a command is in flight. */
  busy: boolean;
  usageSupported: boolean;
  /** Omitted while the session's folder is unknown. */
  workspaceKnown: boolean;
  providerSessionId: string | null;
  workspacePath: string | null;
  onRename: () => void;
  onCompact: () => void;
  onUsage: () => void;
  onOpenWorkspace: () => void;
  onCopy: (value: string, label: string) => void;
};

/** The session menu's rows, in order, with their availability. */
export function agentSessionMenuSections(
  input: AgentSessionMenuInput,
): AgentMenuSection[] {
  const session: AgentMenuSection = { items: [] };
  if (input.renameSupported)
    session.items.push({
      key: "rename",
      label: "Rename",
      icon: "pencil-outline",
      disabled: !input.ready,
      onSelect: input.onRename,
    });
  session.items.push({
    key: "compact",
    label: "Compact context",
    icon: "sparkles-outline",
    disabled: !input.ready || input.busy,
    onSelect: input.onCompact,
  });
  if (input.usageSupported)
    session.items.push({
      key: "usage",
      label: "Account usage",
      icon: "speedometer-outline",
      disabled: !input.ready || input.busy,
      onSelect: input.onUsage,
    });
  const workspace: AgentMenuSection = { items: [] };
  if (input.workspaceKnown)
    workspace.items.push({
      key: "workspace",
      label: "Open workspace",
      icon: "folder-open-outline",
      onSelect: input.onOpenWorkspace,
    });
  if (input.providerSessionId)
    workspace.items.push({
      key: "copy-session",
      label: "Copy session ID",
      icon: "copy-outline",
      onSelect: () => input.onCopy(input.providerSessionId!, "Session ID"),
    });
  if (input.workspacePath)
    workspace.items.push({
      key: "copy-path",
      label: "Copy workspace path",
      icon: "copy-outline",
      onSelect: () => input.onCopy(input.workspacePath!, "Workspace path"),
    });
  return [session, workspace];
}

export async function copyToClipboard(value: string, label: string) {
  try {
    await Clipboard.setStringAsync(value);
    toastSuccess(`${label} copied`);
  } catch (error) {
    toastError(`Couldn't copy ${label.toLowerCase()}`, error);
  }
}

/**
 * Header kebab for an agent conversation. The button stays mounted while the
 * session loads (greyed out) so the header does not reflow.
 */
export function AgentSessionHeaderMenu({
  title,
  disabled,
  ...input
}: Omit<AgentSessionMenuInput, "onCopy"> & {
  title: string;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  const menu = useMeasuredPopoverAnchor();
  return (
    <>
      <Pressable
        ref={menu.anchorRef}
        accessibilityRole="button"
        accessibilityLabel="Session actions"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          menu.open();
        }}
        hitSlop={10}
        style={[styles.button, { opacity: disabled ? 0.4 : 1 }]}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.foreground} />
      </Pressable>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        title={title}
        sections={agentSessionMenuSections({
          ...input,
          onCopy: (value, label) => void copyToClipboard(value, label),
        })}
        onClose={menu.close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { padding: 12 },
});
