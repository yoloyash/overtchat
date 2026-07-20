import type {
  PrepareStepFunction,
  ToolApprovalConfiguration,
  ToolApprovalStatus,
} from "ai";
import type { SharedV4ProviderOptions as ProviderOptions } from "@ai-sdk/provider";
import {
  CHAT_TOOL_NAMES,
  WEB_TOOL_NAMES,
  chatTools,
} from "@/lib/tools";
import type { ChatRuntimeContext } from "@/lib/runtime-context";
import type { ToolSelectionStrategy } from "@/lib/providers/server/types";

const WEB_DISABLED_REASON =
  "Web search is disabled by the user for this turn.";
const WEB_UNAVAILABLE_REASON =
  "Web search is unavailable for the selected model.";
const SEARCH_FIRST_REASON =
  "web_search must run before other tools for this turn.";

export interface ToolStepPolicy {
  allowedToolNames: string[];
  toolChoice: "auto" | "none" | "required";
  providerOptions?: ProviderOptions;
  runtimeContext: ChatRuntimeContext;
}

/**
 * Compute the callable subset without removing definitions from the request.
 * Unknown future tools are independent from the Web Search toggle. When
 * search is explicitly required, they become callable after the first search.
 */
export function getAllowedToolNames(
  runtimeContext: ChatRuntimeContext,
  toolNames: readonly string[] = CHAT_TOOL_NAMES,
): string[] {
  if (
    runtimeContext.webSearchMode === "required" &&
    !runtimeContext.webSearchAttempted
  ) {
    return toolNames.filter((toolName) => toolName === "web_search");
  }

  if (
    runtimeContext.webSearchMode === "disabled" ||
    runtimeContext.webSearchMode === "unavailable"
  ) {
    return toolNames.filter(
      (toolName) => !WEB_TOOL_NAMES.has(toolName as keyof typeof chatTools),
    );
  }

  return [...toolNames];
}

export function resolveToolStepPolicy({
  runtimeContext,
  webSearchAttempted = runtimeContext.webSearchAttempted,
  strategy,
  toolNames = CHAT_TOOL_NAMES,
}: {
  runtimeContext: ChatRuntimeContext;
  webSearchAttempted?: boolean;
  strategy: ToolSelectionStrategy;
  toolNames?: readonly string[];
}): ToolStepPolicy {
  const nextRuntimeContext =
    webSearchAttempted === runtimeContext.webSearchAttempted
      ? runtimeContext
      : { ...runtimeContext, webSearchAttempted };
  const allowedToolNames = getAllowedToolNames(
    nextRuntimeContext,
    toolNames,
  );
  const searchStillRequired =
    nextRuntimeContext.webSearchMode === "required" &&
    !nextRuntimeContext.webSearchAttempted;

  if (allowedToolNames.length === 0) {
    return {
      allowedToolNames,
      // Some APIs (notably Anthropic) have no native `none`; their SDK drops
      // tool definitions to emulate it. `auto` plus approval denial keeps the
      // cache-stable registry on the wire without allowing execution.
      toolChoice: strategy === "approval-only" ? "auto" : "none",
      runtimeContext: nextRuntimeContext,
    };
  }

  return {
    allowedToolNames,
    toolChoice: searchStillRequired ? "required" : "auto",
    providerOptions:
      strategy === "openai-allowed-tools"
        ? {
            openai: {
              allowedTools: {
                toolNames: allowedToolNames,
                mode: searchStillRequired ? "required" : "auto",
              },
            },
          }
        : undefined,
    runtimeContext: nextRuntimeContext,
  };
}

/**
 * AI SDK approval is the application enforcement boundary. Provider tool
 * choice narrows cooperative models; this still prevents a non-compliant
 * provider from executing a disabled or out-of-sequence tool call.
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
  if (
    runtimeContext.webSearchMode === "required" &&
    !runtimeContext.webSearchAttempted &&
    toolName !== "web_search"
  ) {
    return { type: "denied", reason: SEARCH_FIRST_REASON };
  }

  return { type: "not-applicable" };
}

export function createChatPrepareStep(
  strategy: ToolSelectionStrategy,
): PrepareStepFunction<typeof chatTools, ChatRuntimeContext> {
  return ({ steps, runtimeContext }) => {
    const webSearchAttempted =
      runtimeContext.webSearchAttempted ||
      steps.some((step) =>
        step.toolCalls.some((toolCall) => toolCall.toolName === "web_search"),
      );

    const policy = resolveToolStepPolicy({
      runtimeContext,
      webSearchAttempted,
      strategy,
    });

    return {
      toolChoice: policy.toolChoice,
      providerOptions: policy.providerOptions,
      runtimeContext: policy.runtimeContext,
    };
  };
}

/** Remove saved values for the provider option owned by runtime policy. */
export function sanitizeToolProviderOptions(
  providerOptions: ProviderOptions | undefined,
  strategy: ToolSelectionStrategy,
): ProviderOptions | undefined {
  if (strategy !== "openai-allowed-tools" || !providerOptions?.openai) {
    return providerOptions;
  }

  const openai = { ...providerOptions.openai };
  delete openai.allowedTools;

  const sanitized = { ...providerOptions };
  if (Object.keys(openai).length === 0) delete sanitized.openai;
  else sanitized.openai = openai;

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
