import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { i18n } from "@overtchat/shared/i18n";
import { View } from "react-native";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { AgentMenu, type AgentMenuItem } from "./AgentMenu";
import { AgentIconButton } from "./AgentPrimitives";

/** Fork destinations, as menu items. */
export function agentForkMenuItems(
  onFork: (chooseWorkspace: boolean) => void,
  t: TFunction = i18n.t.bind(i18n),
): AgentMenuItem[] {
  return [
    {
      key: "fork:session",
      label: t("agents.fork.inNewSession"),
      icon: "git-branch-outline",
      onSelect: () => onFork(false),
    },
    {
      key: "fork:workspace",
      label: t("agents.fork.inAnotherWorkspace"),
      icon: "folder-open-outline",
      onSelect: () => onFork(true),
    },
  ];
}

export function AgentForkMenu({
  disabled,
  onFork,
}: {
  disabled: boolean;
  onFork: (chooseWorkspace: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const menu = useMeasuredPopoverAnchor();
  const [pending, setPending] = useState(false);
  return (
    <>
      <View ref={menu.anchorRef} collapsable={false}>
        <AgentIconButton
          label={t("agents.mobile.fork.buttonLabel")}
          icon="git-branch-outline"
          disabled={disabled || pending}
          loading={pending}
          onPress={menu.open}
        />
      </View>
      <AgentMenu
        from={menu.anchorRect}
        visible={menu.visible}
        sections={[
          {
            items: agentForkMenuItems((chooseWorkspace) => {
              setPending(true);
              void onFork(chooseWorkspace).finally(() => setPending(false));
            }, t),
          },
        ]}
        onClose={menu.close}
      />
    </>
  );
}
