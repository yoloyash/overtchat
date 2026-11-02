import "server-only";
import type { ModelReasoningLevel } from "@overtchat/shared";
import {
  MODEL_REASONING_LEVELS,
  mergeRequestFields,
  type ReasoningOverride,
  type ThinkingCheckResult,
} from "@/lib/model-config/reasoning-override";
import type { TemplateRenderer } from "@/lib/providers/server/http";

/**
 * Renders the prompt once without thinking fields and once per configured
 * level. Nothing is generated; the result only reports which levels the loaded
 * template distinguishes.
 */
export async function checkThinkingLevels(
  render: TemplateRenderer,
  requests: ReasoningOverride["requests"],
): Promise<ThinkingCheckResult> {
  const baseline = await render({});
  if (!baseline) return { status: "unavailable" };
  const levels = MODEL_REASONING_LEVELS.filter((level) => level in requests);
  const prompts = await Promise.all(
    levels.map((level) => render(mergeRequestFields({}, requests[level]!))),
  );
  const failed: ModelReasoningLevel[] = [];
  const byPrompt = new Map<string, ModelReasoningLevel[]>();
  levels.forEach((level, index) => {
    const prompt = prompts[index];
    if (!prompt) {
      failed.push(level);
      return;
    }
    byPrompt.set(prompt, [...(byPrompt.get(prompt) ?? []), level]);
  });
  return {
    status: "checked",
    failed,
    identical: [...byPrompt.values()].filter((group) => group.length > 1),
    matchesDefault: byPrompt.get(baseline) ?? [],
  };
}
