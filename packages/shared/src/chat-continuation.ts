import type { UIMessage } from "ai";
import { isToolSettled } from "./tools";

/** Only an answer ending in text can be continued as an assistant prefill.
 * Reasoning-only output and incomplete tool arguments require different replay. */
export function canContinueMessage(message: UIMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  if (
    message.parts.some((part) =>
      (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
      !isToolSettled(part as Parameters<typeof isToolSettled>[0]),
    )
  ) return false;
  const last = [...message.parts].reverse().find((part) => part.type !== "step-start");
  return last?.type === "text" && last.text.length > 0;
}
