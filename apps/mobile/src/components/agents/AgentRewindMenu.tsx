import { View } from "react-native";
import type { Ionicons } from "@expo/vector-icons";
import type { AgentRewindMode } from "@overtchat/agent-bridge";
import {
  agentRewindOptions,
  type AgentRewindCapabilities,
} from "@overtchat/shared/agent-presentation";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { AgentMenu, type AgentMenuItem } from "./AgentMenu";
import { AgentIconButton } from "./AgentPrimitives";

export const AGENT_REWIND_NOTE = "This action cannot be undone";

const icons: Record<
  AgentRewindMode,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  conversation: "chatbubbles-outline",
  files: "document-text-outline",
  both: "layers-outline",
};

/** Rewind choices supported by the provider, as menu items. */
export function agentRewindMenuItems(
  capabilities: AgentRewindCapabilities,
  onRewind: (mode: AgentRewindMode) => void,
): AgentMenuItem[] {
  return agentRewindOptions(capabilities).map(({ mode, label }) => ({
    key: `rewind:${mode}`,
    label,
    icon: icons[mode],
    destructive: true,
    onSelect: () => onRewind(mode),
  }));
}

export function AgentRewindMenu({
  capabilities,
  disabled,
  pending,
  onRewind,
}: {
  capabilities: AgentRewindCapabilities;
  disabled: boolean;
  pending: boolean;
  onRewind: (mode: AgentRewindMode) => void;
}) {
  const menu = useMeasuredPopoverAnchor();
  const items = agentRewindMenuItems(capabilities, onRewind);
  if (!items.length) return null;
  return (
    <>
      <View ref={menu.anchorRef} collapsable={false}>
        <AgentIconButton
          label="Rewind to this message"
          icon="arrow-undo-outline"
          disabled={disabled || pending}
          loading={pending}
          onPress={menu.open}
        />
      </View>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        sections={[{ note: AGENT_REWIND_NOTE, items }]}
        onClose={menu.close}
      />
    </>
  );
}
