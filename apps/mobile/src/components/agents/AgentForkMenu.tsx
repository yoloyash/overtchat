import { useState } from "react";
import { AgentButton, AgentSheet } from "./AgentPrimitives";

export function AgentForkMenu({
  disabled,
  onFork,
}: {
  disabled: boolean;
  onFork: (chooseWorkspace: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  async function fork(chooseWorkspace: boolean) {
    if (pending) return;
    setPending(true);
    try {
      await onFork(chooseWorkspace);
    } finally {
      setPending(false);
      setOpen(false);
    }
  }
  return (
    <>
      <AgentButton
        label="Fork conversation"
        disabled={disabled || pending}
        onPress={() => setOpen(true)}
      />
      <AgentSheet
        title="Fork conversation"
        visible={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
      >
        <AgentButton
          label="Fork in new session"
          disabled={disabled || pending}
          onPress={() => void fork(false)}
        />
        <AgentButton
          label="Fork in another workspace"
          disabled={disabled || pending}
          onPress={() => void fork(true)}
        />
      </AgentSheet>
    </>
  );
}
