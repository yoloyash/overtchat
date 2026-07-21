import type { ToolApprovalConfiguration, ToolApprovalStatus } from "ai";
import { WEB_TOOL_NAMES, chatTools } from "@/lib/tools";
import type { ChatRuntimeContext } from "@/lib/runtime-context";

const WEB_DISABLED_REASON = "Web tools are disabled by the user for this turn.";
const WEB_UNAVAILABLE_REASON =
  "Web tools are unavailable for the selected model.";

/**
 * AI SDK approval is the application enforcement boundary. Tool definitions
 * and provider-native `toolChoice: "auto"` stay stable across the user toggle.
 */
export const chatToolApproval: ToolApprovalConfiguration<
  typeof chatTools,
  ChatRuntimeContext
> = ({ toolCall, runtimeContext }) =>
  getToolApprovalStatus(toolCall.toolName, runtimeContext);

export function getToolApprovalStatus(
  toolName: string,
  runtimeContext: ChatRuntimeContext,
): ToolApprovalStatus {
  const isWebTool = WEB_TOOL_NAMES.has(toolName as keyof typeof chatTools);

  if (isWebTool && runtimeContext.webSearchMode === "disabled") {
    return { type: "denied", reason: WEB_DISABLED_REASON };
  }
  if (isWebTool && runtimeContext.webSearchMode === "unavailable") {
    return { type: "denied", reason: WEB_UNAVAILABLE_REASON };
  }
  return { type: "not-applicable" };
}
