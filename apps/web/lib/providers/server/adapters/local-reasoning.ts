import type { ChatReasoningLevel } from "@overtchat/shared";
import {
  legacyReasoningFields,
  mergeRequestFields,
  type ReasoningRequestFields,
} from "@/lib/model-config/reasoning-override";

export function applyLocalReasoningLevel(
  body: Record<string, unknown>,
  level: ChatReasoningLevel | undefined,
  requestFields?: ReasoningRequestFields,
): Record<string, unknown> {
  if (!level || level === "default") return body;
  return mergeRequestFields(body, requestFields ?? legacyReasoningFields(level));
}
