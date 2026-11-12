import "server-only";
import { asSchema, type Tool } from "ai";
import {
  CALENDAR_COMMAND,
  CALENDAR_COMMAND_PATTERN,
  CHAT_SKILL_NAMES,
  GMAIL_COMMAND,
  GMAIL_COMMAND_PATTERN,
  OPENUI_PRESENT_TOOL_NAME,
  type ChatSkillId,
} from "@overtchat/shared";
import {
  CALENDAR_TOOL_PROMPT,
  calendarAccess,
  calendarReconnectPrompt,
  createCalendarTools,
} from "@/lib/integrations/calendar-tools";
import {
  GMAIL_TOOL_ORDER,
  createGmailTools,
  gmailAccess,
  gmailOfferedToolNames,
  gmailReconnectPrompt,
  gmailToolPrompt,
} from "@/lib/integrations/gmail-tools";
import { OPENUI_TOOL_PROMPT } from "@/lib/openui/tools";

/** One tool as a skill describes it to a model, since it is not in the tool list. */
export interface SkillToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * A skill as one chat request sees it: what the manifest says, what a view
 * returns, and the tools `call_tool` may run for it.
 */
export interface ChatSkill {
  id: ChatSkillId;
  name: string;
  /** One line for the manifest, which every request carries. */
  description: string;
  /** The instructions a view loads. */
  content: string;
  /** Tools the skill provides, run through `call_tool`. */
  tools: Record<string, Tool>;
  /**
   * The tools as a model reads them. One that an earlier version of the
   * skill named can be left out here and still run.
   */
  toolSpecs: SkillToolSpec[];
  /**
   * Tools of the skill a stored message can hold a call of although this
   * request cannot run them. A model made those calls through `call_tool`
   * too, so they are replayed that way.
   */
  replayedToolNames?: readonly string[];
  /** What the user types to load the skill in one chat. */
  command?: string;
  /** Opens a message that asks for the skill by typing its command. */
  commandPattern?: RegExp;
  /** The user chose to load the skill in every chat. */
  alwaysOn: boolean;
}

export interface ResolveChatSkillsOptions {
  userId: string;
  /** Whether the client renders interactive UI, and whether the user loads it everywhere. */
  interactiveUi: { offered: boolean; alwaysOn: boolean };
  /** Whether the client shows an email a model wrote as a card to send from. */
  gmailCompose: boolean;
}

/** The skills a user's chats may load, with the tools each may run. */
export async function resolveChatSkills({
  userId,
  interactiveUi,
  gmailCompose,
}: ResolveChatSkillsOptions): Promise<ChatSkill[]> {
  const skills: ChatSkill[] = [];

  const gmail = gmailAccess(userId);
  if (gmail.status !== "unavailable") {
    const options = { compose: gmailCompose };
    const tools: Record<string, Tool> =
      gmail.status === "available" ? createGmailTools(userId, options) : {};
    const offered = gmailOfferedToolNames(options);
    skills.push({
      id: "gmail",
      name: CHAT_SKILL_NAMES.gmail,
      description:
        "Search, read and organize the user's own Gmail, and write emails for them to send. Load it when a request needs their mail.",
      content:
        gmail.status === "available"
          ? gmailToolPrompt(options)
          : gmailReconnectPrompt(),
      tools,
      toolSpecs: await describeTools(
        Object.fromEntries(
          Object.entries(tools).filter(([name]) => offered.includes(name)),
        ),
      ),
      // Another client of the same chat may have been given gmail_compose.
      ...(gmail.status === "available"
        ? { replayedToolNames: GMAIL_TOOL_ORDER }
        : {}),
      command: GMAIL_COMMAND,
      commandPattern: GMAIL_COMMAND_PATTERN,
      alwaysOn: gmail.alwaysOn,
    });
  }

  const calendar = calendarAccess(userId);
  if (calendar.status !== "unavailable") {
    const tools =
      calendar.status === "available" ? createCalendarTools(userId) : {};
    skills.push({
      id: "calendar",
      name: CHAT_SKILL_NAMES.calendar,
      description:
        "Read the user's own Google Calendar and add, change or delete events. Load it when a request needs their schedule.",
      content:
        calendar.status === "available"
          ? CALENDAR_TOOL_PROMPT
          : calendarReconnectPrompt(),
      tools,
      toolSpecs: await describeTools(tools),
      command: CALENDAR_COMMAND,
      commandPattern: CALENDAR_COMMAND_PATTERN,
      alwaysOn: calendar.alwaysOn,
    });
  }

  if (interactiveUi.offered) {
    skills.push({
      id: "interactive_ui",
      name: CHAT_SKILL_NAMES.interactive_ui,
      description: `Present an answer as an interactive interface with charts, data tables, forms, dashboards, KPI cards, carousels, tabs or step-by-step guides, rendered by ${OPENUI_PRESENT_TOOL_NAME}. Load it when the user asks for an interactive interface or when such components clearly help.`,
      content: OPENUI_TOOL_PROMPT,
      tools: {},
      toolSpecs: [],
      alwaysOn: interactiveUi.alwaysOn,
    });
  }

  return skills;
}

async function describeTools(
  tools: Record<string, Tool>,
): Promise<SkillToolSpec[]> {
  const specs: SkillToolSpec[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    const parameters = tool.inputSchema
      ? { ...(await asSchema(tool.inputSchema).jsonSchema) }
      : { type: "object", properties: {} };
    delete (parameters as Record<string, unknown>).$schema;
    specs.push({
      name,
      description:
        typeof tool.description === "string" ? tool.description : "",
      parameters: parameters as Record<string, unknown>,
    });
  }
  return specs;
}
