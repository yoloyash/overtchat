import type { ModelMessage, UIMessage } from "ai";
import {
  conversationUsesSkill,
  messageRequestsSkill,
  OPENUI_PRESENT_TOOL_NAME,
  VIEW_SKILL_TOOL_NAME,
  viewedSkillId,
  type ChatSkillId,
} from "@overtchat/shared";
import { skillDocument, skillMarker } from "@/lib/skills/prompt";
import type { ChatSkill } from "@/lib/skills/registry";

/**
 * Records on the message being sent which skills the composer asked for.
 * The server decides this from the request, never from metadata a client
 * put on the message itself.
 */
export function withSkillRequests(
  messages: UIMessage[],
  requested: readonly ChatSkillId[],
): UIMessage[] {
  const last = messages.at(-1);
  if (!last || last.role !== "user") return messages;
  const hasMetadata =
    last.metadata !== null &&
    typeof last.metadata === "object" &&
    "skills" in last.metadata;
  if (!hasMetadata && requested.length === 0) return messages;
  const metadata = {
    ...(last.metadata as Record<string, unknown> | undefined),
  };
  delete metadata.skills;
  if (requested.length) metadata.skills = [...requested];
  return [...messages.slice(0, -1), { ...last, metadata }];
}

/** The skills a chat has loaded, by the user's choice or a model's. */
export function loadedSkills(
  messages: readonly UIMessage[],
  skills: readonly ChatSkill[],
): ChatSkill[] {
  return skills.filter(
    (skill) =>
      skill.alwaysOn ||
      conversationUsesSkill(messages, {
        id: skill.id,
        command: skill.commandPattern,
        isToolPart: (part) =>
          part.type.startsWith("tool-") &&
          Object.hasOwn(skill.tools, part.type.slice(5)),
      }),
  );
}

/** What a message that chose Interactive UI asks of the answer. */
export const INTERACTIVE_UI_REQUEST = `The user selected Interactive UI for this message. Present your answer as an interactive OpenUI interface by calling ${OPENUI_PRESENT_TOOL_NAME}. You may use other available tools first when needed, then call ${OPENUI_PRESENT_TOOL_NAME} for your final response.`;

/**
 * Puts a skill's text beside the first message that asked for it, where it
 * stays for the rest of the conversation. A skill the user loads everywhere
 * is in the system prompt instead; a skill a model viewed is in that tool
 * result. A message that chose Interactive UI also carries that request.
 */
export function withSkillDocuments(
  messages: UIMessage[],
  skills: readonly ChatSkill[],
): UIMessage[] {
  const loaded = new Set<ChatSkillId>(
    skills.filter((skill) => skill.alwaysOn).map((skill) => skill.id),
  );
  return messages.map((message) => {
    if (message.role !== "user") {
      for (const part of message.parts) {
        const viewed = viewedSkillId(part);
        if (viewed) loaded.add(viewed);
        const name = part.type.startsWith("tool-") ? part.type.slice(5) : "";
        for (const skill of skills) {
          if (name && Object.hasOwn(skill.tools, name)) loaded.add(skill.id);
        }
      }
      return message;
    }
    const texts: string[] = [];
    for (const skill of skills) {
      if (
        !messageRequestsSkill(message, {
          id: skill.id,
          command: skill.commandPattern,
        })
      )
        continue;
      if (!loaded.has(skill.id)) {
        loaded.add(skill.id);
        texts.push(skillDocument(skill));
      }
      if (skill.id === "interactive_ui") texts.push(INTERACTIVE_UI_REQUEST);
    }
    if (texts.length === 0) return message;
    return {
      ...message,
      parts: [
        ...message.parts,
        ...texts.map((text) => ({ type: "text" as const, text: `\n${text}` })),
      ],
    };
  });
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "tool-result") {
        if (part.toolName !== VIEW_SKILL_TOOL_NAME) return "";
        const output = part.output;
        return output.type === "text" || output.type === "error-text"
          ? output.value
          : output.type === "json"
            ? JSON.stringify(output.value)
            : "";
      }
      return "";
    })
    .join("\n");
}

/**
 * Keeps a loaded skill in a model's context after compaction has summarized
 * the message or tool result that carried it. The text joins the first user
 * message of the retained window, which is where the window starts.
 */
export function ensureSkillDocuments(
  messages: ModelMessage[],
  skills: readonly ChatSkill[],
): ModelMessage[] {
  const missing = skills.filter((skill) => {
    const marker = skillMarker(skill.id);
    return !messages.some((message) => messageText(message).includes(marker));
  });
  if (missing.length === 0) return messages;
  const index = messages.findIndex((message) => message.role === "user");
  if (index === -1) return messages;
  const target = messages[index];
  const added = missing.map((skill) => ({
    type: "text" as const,
    text: `\n${skillDocument(skill)}`,
  }));
  const content =
    typeof target.content === "string"
      ? [{ type: "text" as const, text: target.content }, ...added]
      : [...target.content, ...added];
  const restored = [...messages];
  restored[index] = { ...target, content } as ModelMessage;
  return restored;
}
