import {
  CALL_TOOL_TOOL_NAME,
  VIEW_SKILL_TOOL_NAME,
  type ChatSkillId,
} from "@overtchat/shared";
import type { ChatSkill } from "@/lib/skills/registry";

/** Opens the text of a loaded skill, wherever it sits in the conversation. */
export function skillMarker(id: ChatSkillId): string {
  return `<skill id="${id}"`;
}

/**
 * A skill's full text: its instructions and, after them, the definitions of
 * the tools it provides. The same text goes into the system prompt for a
 * skill the user loads in every chat, into the result of `view_skill`, and
 * beside a message that asked for the skill, so a model reads one format.
 */
export function skillDocument(skill: ChatSkill): string {
  const tools = skill.toolSpecs.length
    ? `\n\nTools of this skill. Run one with ${CALL_TOOL_TOOL_NAME}, giving its exact name as tool_name and its arguments as params:\n${skill.toolSpecs
        .map((spec) => JSON.stringify(spec))
        .join("\n")}`
    : "";
  return `${skillMarker(skill.id)} name="${skill.name}">\n${skill.content}${tools}\n</skill>`;
}

/**
 * The manifest every request carries, in place of the skills themselves. It
 * lists every skill the user has not loaded everywhere, whether or not this
 * chat has loaded it, so it reads the same for the whole conversation.
 */
export function availableSkillsPrompt(skills: readonly ChatSkill[]): string | null {
  const listed = skills.filter((skill) => !skill.alwaysOn);
  if (listed.length === 0) return null;
  const manifest = listed
    .map(
      (skill) =>
        `<skill>\n<id>${skill.id}</id>\n<name>${skill.name}</name>\n<description>${skill.description}</description>\n</skill>`,
    )
    .join("\n");
  return [
    `The following skills are available, but their instructions are not loaded. When a request needs one, call ${VIEW_SKILL_TOOL_NAME} with its id to load its instructions and tools, then follow them. A loaded skill stays loaded for the rest of the conversation; do not view it again. Run a skill's tools through ${CALL_TOOL_TOOL_NAME} with the exact tool name as tool_name and the arguments as params. Never tell the user something is unavailable without viewing the skill first.`,
    `<available_skills>\n${manifest}\n</available_skills>`,
  ].join("\n");
}
