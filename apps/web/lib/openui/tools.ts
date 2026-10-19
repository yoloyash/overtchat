import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { generateSystemPrompt, type LibrarySpec } from "@openuidev/lang-core";
import { openuiChatPromptOptions } from "@openuidev/react-ui/genui-lib/prompt-options";
import {
  OPENUI_PRESENT_TOOL_NAME,
  normalizeOpenUILang,
  type OpenUIToolOutput,
} from "@overtchat/shared";
import chatLibrarySpecJson from "./chat-library-spec.json";

export const OPENUI_CHAT_LIBRARY_SPEC =
  chatLibrarySpecJson as unknown as LibrarySpec;

export const OPENUI_TOOL_PROMPT = generateSystemPrompt({
  library: OPENUI_CHAT_LIBRARY_SPEC,
  promptOptions: {
    ...openuiChatPromptOptions,
    preamble: [
      "Interactive UI (OpenUI):",
      `When a response benefits from interactive visual components (charts, data tables, forms, dashboards, KPI cards, carousels, tabs, or step-by-step guides) or when the user asks for an interactive UI, render the interface by calling ${OPENUI_PRESENT_TOOL_NAME}.`,
      "For ordinary prose, coding questions, or simple conversational answers where rich UI components add no value, respond normally in Markdown without calling the tool.",
      `When calling ${OPENUI_PRESENT_TOOL_NAME}, set the ui argument to valid OpenUI Lang without markdown code fences, make the tool call the entire response, and never output OpenUI Lang as assistant text.`,
    ].join(" "),
    additionalRules: [
      ...(openuiChatPromptOptions.additionalRules ?? []),
      `When using ${OPENUI_PRESENT_TOOL_NAME}, FollowUpBlock clicks, Button @ToAssistant actions, and Form submissions start a new user turn automatically.`,
    ],
  },
});

export const OPENUI_COMPACT_TOOL_PROMPT = [
  `Interactive UI (OpenUI): Render interactive interfaces by calling ${OPENUI_PRESENT_TOOL_NAME} with valid OpenUI Lang in the ui argument (no markdown fences).`,
  "Always start with root = Card([...]) and define child statements below it using positional arguments.",
  'Core components: CardHeader(title, subtitle?), TextContent(text, size?), BarChart(labels, [Series(name, values)]), LineChart(labels, [Series(name, values)]), Table([Col(label, values, type?)]), OverviewCardBlock([OverviewCardItem(title, value, subtitle?, icon?, trend?)]), ListBlock([ListItem(title, subtitle?, icon?, image?, action?)], variant?), Form(name, Buttons([Button(label, action?, variant?)]), [FormControl(label, Input(name, placeholder?, type?), hint?)]), FollowUpBlock([FollowUpItem(text)]).',
].join("\n");

export function createOpenUITools() {
  return Object.freeze({
    [OPENUI_PRESENT_TOOL_NAME]: tool<
      { ui: string },
      OpenUIToolOutput,
      Record<string, never>
    >({
      description:
        "Render a complete OpenUI Lang interface (charts, tables, forms, cards, tabs, steps, follow-up actions) inline in the chat.",
      inputSchema: z.object({
        ui: z
          .string()
          .describe("A complete OpenUI Lang program with Card as its root"),
      }),
      execute: async ({ ui }) => {
        if (!normalizeOpenUILang(ui).trim()) {
          throw new Error("OpenUI program cannot be empty.");
        }
        return { displayed: true as const };
      },
    }),
  });
}

export const OPENUI_TOOL_ORDER = Object.freeze([
  OPENUI_PRESENT_TOOL_NAME,
] as const);
