import { useState } from "react";
import type {
  AgentRewindMode,
  AgentRuntimeCapabilities,
} from "@overtchat/agent-bridge";
import { agentRewindOptions } from "@overtchat/shared/agent-presentation";
import { AgentButton, AgentSheet, AgentText } from "./AgentPrimitives";

export function AgentRewindMenu({
  capabilities,
  disabled,
  onRewind,
}: {
  capabilities: AgentRuntimeCapabilities;
  disabled: boolean;
  onRewind: (mode: AgentRewindMode) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const options = agentRewindOptions(capabilities);
  if (!options.length) return null;
  return (
    <>
      <AgentButton
        label="Rewind to this message"
        disabled={disabled || pending}
        onPress={() => setOpen(true)}
      />
      <AgentSheet
        visible={open}
        title="Rewind to this message"
        onClose={() => {
          if (!pending) setOpen(false);
        }}
      >
        <AgentText muted>This action cannot be undone</AgentText>
        {options.map(({ mode, label }) => (
          <AgentButton
            key={mode}
            label={label}
            disabled={disabled || pending}
            onPress={async () => {
              if (pending) return;
              setPending(true);
              try {
                await onRewind(mode);
              } finally {
                setPending(false);
                setOpen(false);
              }
            }}
          />
        ))}
      </AgentSheet>
    </>
  );
}
