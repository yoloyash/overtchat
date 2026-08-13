import type {
  AgentPromptImage,
  AgentRuntimeSnapshot,
  AgentSessionCommand,
} from "@overtchat/agent-bridge";
import {
  buildAgentPromptCommand,
  normalizeAgentSessionCommand,
} from "@overtchat/agent-bridge";

export function commandForAgentSessionSubmit(
  snapshot: AgentRuntimeSnapshot,
  message: string,
  images: AgentPromptImage[],
): AgentSessionCommand {
  const prompt = buildAgentPromptCommand(message, images);
  const usageCommand =
    snapshot.capabilities.usage === true &&
    images.length === 0 &&
    /^\/usage\s*$/iu.test(message)
      ? ({ type: "show_usage" } as const)
      : null;
  const normalized =
    usageCommand ?? normalizeAgentSessionCommand(prompt, snapshot.state);
  const busy =
    snapshot.status === "running" || snapshot.state.isCompacting === true;

  return normalized.type !== "prompt" || !busy
    ? normalized
    : {
        type: "queue",
        message,
        ...(images.length > 0 ? { images } : {}),
      };
}
