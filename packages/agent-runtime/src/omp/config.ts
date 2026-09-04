import {
  agentProviderCreationDefaults,
  type AgentMode,
} from "@overtchat/agent-bridge";

export const OMP_MODES: AgentMode[] = [
  ...agentProviderCreationDefaults("omp").modes,
];

export function ompApprovalMode(modeId: string): string {
  const approvalMode = {
    full: "yolo",
    write: "write",
    ask: "always-ask",
  }[modeId];
  if (!approvalMode) throw new Error(`Unsupported Oh My Pi mode "${modeId}".`);
  return approvalMode;
}
