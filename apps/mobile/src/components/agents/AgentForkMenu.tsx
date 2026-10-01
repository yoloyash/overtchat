import { useState } from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/theme";
import { AgentButton, AgentSheet } from "./AgentPrimitives";

export function AgentForkMenu({
  disabled,
  onFork,
}: {
  disabled: boolean;
  onFork: (chooseWorkspace: boolean) => Promise<void>;
}) {
  const { colors } = useTheme();
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fork conversation"
        accessibilityState={{ disabled: disabled || pending }}
        disabled={disabled || pending}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled || pending ? 0.45 : 1,
          backgroundColor: pressed ? colors.muted : "transparent",
        })}
      >
        <Ionicons name="git-branch-outline" size={18} color={colors.mutedForeground} />
      </Pressable>
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
