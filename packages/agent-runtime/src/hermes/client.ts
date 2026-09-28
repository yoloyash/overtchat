import { AcpRuntimeClient, type AcpProvider } from "../acp/client";
import type { AgentSessionLaunch } from "../providers/types";
import type { HostTarget } from "../runtime/process";

export const HERMES_ACP: AcpProvider = {
  id: "hermes",
  label: "Hermes",
  args: ["acp"],
  compactCommand: "/compress",
  dangerousModes: ["accept_edits", "dont_ask"],
  reloadCommands: ["reset", "compress", "model"],
  historyUserText: (text) => {
    const open =
      "[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]";
    const close = "[/OUT-OF-BAND USER MESSAGE]";
    return text.startsWith(open) && text.endsWith(close)
      ? text.slice(open.length, -close.length).trim()
      : text;
  },
};

export function startHermesRuntime(
  target: HostTarget,
  launch: AgentSessionLaunch,
): AcpRuntimeClient {
  return new AcpRuntimeClient(target, launch, HERMES_ACP);
}
