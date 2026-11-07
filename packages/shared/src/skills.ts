import type { ToolState } from "./tools";

/**
 * Skills keep a connector's instructions and tool definitions out of a chat
 * until a message needs them. Every chat gets the same two tools, so the
 * tool list a model is given never changes partway through a conversation
 * and a prompt cache or a local engine's prefix is never thrown away:
 *
 * - `view_skill` returns a skill's instructions and its tool definitions.
 * - `call_tool` runs one of those tools by name.
 *
 * A skill's text is loaded once into a chat and then stays, in the tool
 * result that loaded it or beside the message that asked for it.
 */
export const VIEW_SKILL_TOOL_NAME = "view_skill" as const;
export const CALL_TOOL_TOOL_NAME = "call_tool" as const;
export const SKILL_TOOL_NAMES = [VIEW_SKILL_TOOL_NAME, CALL_TOOL_TOOL_NAME] as const;

export const CHAT_SKILL_IDS = ["gmail", "calendar", "interactive_ui"] as const;
export type ChatSkillId = (typeof CHAT_SKILL_IDS)[number];

/** How each skill is named to people and to models. */
export const CHAT_SKILL_NAMES: Record<ChatSkillId, string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  interactive_ui: "Interactive UI",
};

export function isChatSkillId(value: unknown): value is ChatSkillId {
  return (
    typeof value === "string" &&
    (CHAT_SKILL_IDS as readonly string[]).includes(value)
  );
}

export const VIEW_SKILL_PART_TYPE = `tool-${VIEW_SKILL_TOOL_NAME}` as const;

export interface ViewSkillToolPart {
  type: typeof VIEW_SKILL_PART_TYPE;
  toolCallId: string;
  state: ToolState;
  input?: { id?: unknown };
  /** The skill's text, or a line starting with "Error:". */
  output?: unknown;
  errorText?: string;
}

export function isViewSkillToolPart(part: {
  type: string;
}): part is ViewSkillToolPart {
  return part.type === VIEW_SKILL_PART_TYPE;
}

/** The skill a `view_skill` call loaded, once it has. */
export function viewedSkillId(part: { type: string }): ChatSkillId | null {
  if (!isViewSkillToolPart(part) || part.state !== "output-available")
    return null;
  const id = part.input?.id;
  return isChatSkillId(id) &&
    typeof part.output === "string" &&
    part.output.startsWith("<skill ")
    ? id
    : null;
}

/** What the activity line says for a `view_skill` step. */
export function viewSkillActivityLabel(
  part: ViewSkillToolPart,
  active: boolean,
): string {
  const id = part.input?.id;
  const name = isChatSkillId(id) ? CHAT_SKILL_NAMES[id] : "a";
  if (active) return `Loading ${name} skill…`;
  if (part.state === "output-error") return "Skill could not load";
  if (part.state !== "output-available") return "Skill load did not complete";
  return viewedSkillId(part) ? `Loaded ${name} skill` : "Skill unavailable";
}

type SkillMessage = {
  role: string;
  metadata?: unknown;
  parts: readonly { type: string; text?: unknown }[];
};

/**
 * Skills a user message asked for: the composer's connector and Interactive
 * UI choices, which the server records in the message's metadata.
 */
export function skillsRequestedByMessage(message: {
  role: string;
  metadata?: unknown;
}): ChatSkillId[] {
  if (message.role !== "user") return [];
  const metadata = message.metadata;
  const skills =
    metadata !== null && typeof metadata === "object" && "skills" in metadata
      ? (metadata as { skills?: unknown }).skills
      : undefined;
  return Array.isArray(skills) ? skills.filter(isChatSkillId) : [];
}

/**
 * Whether a user message asks for a skill: the composer recorded it, or the
 * message opens with the skill's command typed out, which is how a client
 * without a command menu asks.
 */
export function messageRequestsSkill(
  message: SkillMessage,
  skill: { id: ChatSkillId; command?: RegExp },
): boolean {
  if (message.role !== "user") return false;
  return (
    skillsRequestedByMessage(message).includes(skill.id) ||
    (skill.command !== undefined &&
      message.parts.some(
        (part) =>
          part.type === "text" &&
          typeof part.text === "string" &&
          skill.command!.test(part.text),
      ))
  );
}

/**
 * Whether a conversation has loaded a skill: a user message asked for it, a
 * model viewed it, or a model already used one of its tools. A chat keeps a
 * skill once it has it.
 */
export function conversationUsesSkill(
  messages: readonly SkillMessage[],
  skill: {
    id: ChatSkillId;
    command?: RegExp;
    isToolPart?: (part: { type: string }) => boolean;
  },
): boolean {
  return messages.some(
    (message) =>
      messageRequestsSkill(message, skill) ||
      (message.role !== "user" &&
        message.parts.some(
          (part) =>
            viewedSkillId(part) === skill.id ||
            skill.isToolPart?.(part) === true,
        )),
  );
}
