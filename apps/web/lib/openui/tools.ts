import "server-only";
import { tool, type StopCondition, type ToolSet } from "ai";
import { z } from "zod";
import {
  createParser,
  generateSystemPrompt,
  type LibrarySpec,
} from "@openuidev/lang-core";
import {
  OPENUI_PRESENT_TOOL_NAME,
  OPENUI_MAX_PROGRAM_LENGTH,
  normalizeOpenUILang,
  type OpenUIToolOutput,
} from "@overtchat/shared";
import chatLibrarySpecJson from "./chat-library-spec.json";

export const OPENUI_CHAT_LIBRARY_SPEC =
  chatLibrarySpecJson as unknown as LibrarySpec;

export const OPENUI_TOOL_PROMPT = generateSystemPrompt({
  library: OPENUI_CHAT_LIBRARY_SPEC,
  promptOptions: {
    toolCalls: false,
    bindings: true,
    builtinFunctions: true,
    preamble: [
      "Interactive UI (OpenUI):",
      `When a response benefits from interactive visual components (charts, data tables, forms, dashboards, KPI cards, carousels, tabs, or step-by-step guides) or when the user asks for an interactive UI, render the interface by calling ${OPENUI_PRESENT_TOOL_NAME}.`,
      "For ordinary prose, coding questions, or simple conversational answers where rich UI components add no value, respond normally in Markdown without calling the tool.",
      `When calling ${OPENUI_PRESENT_TOOL_NAME}, set the ui argument to valid OpenUI Lang without markdown code fences, make the tool call the entire response, and never output OpenUI Lang as assistant text.`,
    ].join(" "),
    additionalRules: [
      "Only use components and actions in this library. Query and Mutation are unavailable; use chat tools to obtain data before presentation.",
      "Provide a complete readable equivalent in the text argument, including important values, labels and sources. It is used for copy, speech, search and fallback; do not repeat it as assistant prose.",
      `When using ${OPENUI_PRESENT_TOOL_NAME}, FollowUpBlock clicks, Button @ToAssistant actions, and Form submissions start a new user turn automatically.`,
    ],
  },
});

const parser = createParser(OPENUI_CHAT_LIBRARY_SPEC.schema!, "Card");

export function validateOpenUIProgram(ui: unknown): string {
  const code = normalizeOpenUILang(ui).trim();
  if (!code) throw new Error("OpenUI program cannot be empty.");
  if (code.length > OPENUI_MAX_PROGRAM_LENGTH)
    throw new Error("OpenUI program is too large. Simplify the interface.");
  const parsed = parser.parse(code);
  // Match the upstream Renderer: diagnostics describe recovery (dropped args,
  // invalid children, unresolved references), not necessarily a failed UI.
  // Unlike Renderer we can ask the model to repair, so a truncated program or
  // one that recovers to an empty Card still fails instead of showing nothing.
  const children = parsed.root?.props.children;
  if (
    !parsed.root ||
    parsed.meta.incomplete ||
    !Array.isArray(children) ||
    !children.length
  ) {
    const errors = parsed.meta.errors
      .filter((error) => error.severity !== "warning")
      .slice(0, 3)
      .map((error) => error.message)
      .join("; ");
    const unresolved = parsed.meta.unresolved.slice(0, 3).join(", ");
    throw new Error(
      `Invalid OpenUI program. Fix it and call present_openui again: ${
        parsed.meta.incomplete
          ? "The program is incomplete; close every call, list and string."
          : errors ||
            (unresolved
              ? `Define every referenced statement: ${unresolved}.`
              : "Provide a Card root with at least one renderable child.")
      }`,
    );
  }
  if (parsed.queryStatements.length || parsed.mutationStatements.length) {
    throw new Error(
      "Query and Mutation are unavailable in this interface. Obtain data with chat tools first and include it in the UI.",
    );
  }
  return code;
}

/** A failed presentation must remain visible to the model for a bounded repair. */
export const hasSuccessfulOpenUI: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (result) =>
        result.toolName === OPENUI_PRESENT_TOOL_NAME &&
        typeof result.output === "object" &&
        result.output !== null &&
        "displayed" in result.output &&
        result.output.displayed === true,
    ) ?? false;

export function createOpenUITools() {
  return Object.freeze({
    [OPENUI_PRESENT_TOOL_NAME]: tool<
      { ui: string; text: string },
      OpenUIToolOutput,
      Record<string, never>
    >({
      description:
        "Render a complete OpenUI Lang interface (charts, tables, forms, cards, tabs, steps, follow-up actions) inline in the chat.",
      inputSchema: z.object({
        ui: z
          .string()
          .max(OPENUI_MAX_PROGRAM_LENGTH)
          .describe("A complete OpenUI Lang program with Card as its root"),
        text: z
          .string()
          .trim()
          .min(1)
          .max(32_000)
          .describe(
            "Complete readable equivalent of the answer, including important data, labels and sources; used for fallback, copy, speech and search.",
          ),
      }),
      execute: async ({ ui, text }) => {
        validateOpenUIProgram(ui);
        return { displayed: true as const, text };
      },
      toModelOutput: () => ({ type: "json", value: { displayed: true } }),
    }),
  });
}

export const OPENUI_TOOL_ORDER = Object.freeze([
  OPENUI_PRESENT_TOOL_NAME,
] as const);
