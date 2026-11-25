import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
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
  /** The agent is working, so context cannot be compacted yet. */
  busy: boolean;
  /** A command is in flight; another one would be dropped. */
  commandPending: boolean;
  usageSupported: boolean;
  /** Omitted while the session's folder is unknown. */
  workspaceKnown: boolean;
  providerSessionId: string | null;
  workspacePath: string | null;
  onRename: () => void;
  onCompact: () => void;
  onUsage: () => void;
  onOpenWorkspace: () => void;
  onCopy: (value: string, kind: "sessionId" | "workspacePath") => void;
};

/** The session menu's rows, in order, with their availability. */
export function agentSessionMenuSections(
  input: AgentSessionMenuInput,
  t: TFunction = i18n.t.bind(i18n),
): AgentMenuSection[] {
  const session: AgentMenuSection = { items: [] };
  if (input.renameSupported)
    session.items.push({
      key: "rename",
      label: t("sidebar.chat.rename"),
      icon: "pencil-outline",
      // Renaming is metadata, allowed mid-turn as on web.
      disabled: !input.ready || input.commandPending,
      onSelect: input.onRename,
    });
  session.items.push({
    key: "compact",
    label: t("agents.session.compactContext"),
    icon: "sparkles-outline",
    disabled: !input.ready || input.busy || input.commandPending,
    onSelect: input.onCompact,
  });
  if (input.usageSupported)
    session.items.push({
      key: "usage",
      label: t("agents.session.accountUsage"),
      icon: "speedometer-outline",
      disabled: !input.ready || input.busy || input.commandPending,
      onSelect: input.onUsage,
    });
  const workspace: AgentMenuSection = { items: [] };
  if (input.workspaceKnown)
    workspace.items.push({
      key: "workspace",
      label: t("agents.mobile.session.openWorkspace"),
      icon: "folder-open-outline",
      onSelect: input.onOpenWorkspace,
    });
  if (input.providerSessionId)
    workspace.items.push({
      key: "copy-session",
      label: t("agents.session.copySessionId"),
      icon: "copy-outline",
      onSelect: () => input.onCopy(input.providerSessionId!, "sessionId"),
    });
  if (input.workspacePath)
    workspace.items.push({
      key: "copy-path",
      label: t("agents.session.copyWorkspacePath"),
      icon: "copy-outline",
      onSelect: () => input.onCopy(input.workspacePath!, "workspacePath"),
    });
  return [session, workspace];
}

export async function copyToClipboard(
  value: string,
  kind: "sessionId" | "workspacePath",
) {
  try {
    await Clipboard.setStringAsync(value);
    toastSuccess(
      i18n.t(
        kind === "sessionId"
          ? "agents.session.sessionIdCopied"
          : "agents.session.workspacePathCopied",
      ),
    );
  } catch (error) {
    toastError(
      i18n.t(
        kind === "sessionId"
          ? "agents.mobile.session.copySessionIdFailed"
          : "agents.mobile.session.copyWorkspacePathFailed",
      ),
      error,
    );
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
  const { t } = useTranslation();
  const { colors } = useTheme();
  const menu = useMeasuredPopoverAnchor();
  return (
    <>
      <Pressable
        ref={menu.anchorRef}
        accessibilityRole="button"
        accessibilityLabel={t("agents.session.actions")}
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
        sections={agentSessionMenuSections(
          {
            ...input,
            onCopy: (value, kind) => void copyToClipboard(value, kind),
          },
          t,
        )}
        onClose={menu.close}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: { padding: 12 },
});
