import { useState } from "react";
import { View } from "react-native";
import { useMeasuredPopoverAnchor } from "@/components/ui/useMeasuredPopoverAnchor";
import { AgentMenu, type AgentMenuItem } from "./AgentMenu";
import { AgentIconButton } from "./AgentPrimitives";

/** Fork destinations, as menu items. */
export function agentForkMenuItems(
  onFork: (chooseWorkspace: boolean) => void,
): AgentMenuItem[] {
  return [
    {
      key: "fork:session",
      label: "Fork in new session",
      icon: "git-branch-outline",
      onSelect: () => onFork(false),
    },
    {
      key: "fork:workspace",
      label: "Fork in another workspace",
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
  const menu = useMeasuredPopoverAnchor();
  const [pending, setPending] = useState(false);
  return (
    <>
      <View ref={menu.anchorRef} collapsable={false}>
        <AgentIconButton
          label="Fork conversation"
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
            }),
          },
        ]}
        onClose={menu.close}
      />
    </>
  );
}
