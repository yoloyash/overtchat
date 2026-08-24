import type { AgentMode } from "@overtchat/agent-bridge";

export const OMP_MODES: AgentMode[] = [
  {
    id: "full",
    label: "Full Access",
    description: "Launches OMP with yolo approval mode so tools run without prompts.",
    dangerous: true,
  },
  {
    id: "write",
    label: "Write Approval",
    description: "Launches OMP with write approval mode — reads are free, writes require approval.",
  },
  {
    id: "ask",
    label: "Always Ask",
    description: "Launches OMP with always-ask approval mode for write and exec tools.",
  },
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
