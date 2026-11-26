import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
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
  t: TFunction,
): AgentMenuItem[] {
  return agentRewindOptions(capabilities, t).map(({ mode, label }) => ({
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
  const { t } = useTranslation();
  const menu = useMeasuredPopoverAnchor();
  const items = agentRewindMenuItems(capabilities, onRewind, t);
  if (!items.length) return null;
  return (
    <>
      <View ref={menu.anchorRef} collapsable={false}>
        <AgentIconButton
          label={t("agents.rewind.toMessage")}
          icon="arrow-undo-outline"
          disabled={disabled || pending}
          loading={pending}
          onPress={menu.open}
        />
      </View>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        sections={[{ note: t("agents.rewind.cannotBeUndone"), items }]}
        onClose={menu.close}
      />
    </>
  );
}
