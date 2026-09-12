import { useEffect, useState } from "react";
import { View } from "react-native";
import type { StreamStatus } from "@/lib/agents/stream";
import { AgentButton, AgentFeedback, AgentText } from "./AgentPrimitives";

/** Keep transport readiness immediate; only delay the visible recovery notice. */
export function AgentConnectionFeedback({
  status,
  error,
  retry,
}: {
  status: StreamStatus;
  error?: string;
  retry: () => void;
}) {
  if (status === "error") return <AgentFeedback error={error} retry={retry} />;
  if (status === "connected" || status === "paused") return null;
  return <ReconnectingFeedback retry={retry} />;
}

function ReconnectingFeedback({ retry }: { retry: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return (
    <View style={{ padding: 16, gap: 8 }}>
      <AgentText muted>Reconnecting to your agent…</AgentText>
      <AgentButton label="Retry" onPress={retry} />
    </View>
  );
}
