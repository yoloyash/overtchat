import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import { createStreamingParser } from "@openuidev/lang-core";
import { ToolLoopAgent, isStepCount } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  normalizeOpenUILang,
  OPENUI_TOOL_PART_TYPE,
  groupMessageParts,
} from "@overtchat/shared";
import { parseChatRequest } from "@/lib/chat/request";
import { countTextTokens } from "@/lib/chat/context-budget";
import {
  OPENUI_CHAT_LIBRARY_SPEC,
  OPENUI_TOOL_PROMPT,
  createOpenUITools,
  hasSuccessfulOpenUI,
  validateOpenUIProgram,
} from "./tools";

const valid = 'root = Card([TextContent("Revenue: 42")])';
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

describe("OpenUI tool contract", () => {
  beforeAll(() => {
    // Building the real tokenizer's vocabulary can exceed a test's 5s budget
    // on a busy runner. Pay that one-time cost in setup instead.
    countTextTokens("Initialize the chat tokenizer.");
  }, 30_000);

  it("uses the exact renderer spec and keeps the complete prompt under 7300 tokens", () => {
    expect(OPENUI_CHAT_LIBRARY_SPEC).toEqual(openuiChatLibrary.toSpec());
    expect(OPENUI_TOOL_PROMPT).toContain("@ToAssistant");
    expect(OPENUI_TOOL_PROMPT).toContain("text argument");
    expect(OPENUI_TOOL_PROMPT).toContain("@Reset");
    expect(OPENUI_TOOL_PROMPT).not.toContain("@Count");
    // Settings quote about 6,800 tokens; update that copy if this range moves.
    expect(countTextTokens(OPENUI_TOOL_PROMPT)).toBeGreaterThan(6300);
    expect(countTextTokens(OPENUI_TOOL_PROMPT)).toBeLessThan(7300);
  });
  it.each([undefined, null, 123, {}, [], true])(
    "safely ignores malformed streamed arguments: %j",
    (value) => {
      expect(normalizeOpenUILang(value)).toBe("");
    },
  );
  it("normalizes fenced programs and rejects programs without renderable content", () => {
    expect(validateOpenUIProgram("```openui\n" + valid + "\n```")).toBe(valid);
    for (const code of [
      "",
      "This is prose",
      'root = NoSuchComponent("hi")',
      "root = missing",
      "root = Card(null)",
      "root = Card([])",
      'root = Card([NoSuchComponent("hi")])',
      'root = Card([TextContent("Revenue: 42")',
    ]) {
      expect(() => validateOpenUIProgram(code)).toThrow();
    }
    expect(() => validateOpenUIProgram("root = Card([missing])")).toThrow(
      "Define every referenced statement: missing.",
    );
  });
  it.each([
    [
      "excess-args",
      'root = Card([TextContent("Revenue: 42")], [], 1, 2, 3, 4, 5)',
    ],
    [
      "type-mismatch",
      'root = Card([TextContent("Revenue: 42", "unsupported")])',
    ],
    [
      "null-required",
      'root = Card([TextContent("Revenue: 42"), TextContent(null)])',
    ],
    [
      "missing-required",
      'root = Card([TextContent("Revenue: 42"), TextContent()])',
    ],
    [
      "unknown-component",
      'root = Card([TextContent("Revenue: 42"), NoSuchComponent("hi")])',
    ],
    ["unresolved", 'root = Card([TextContent("Revenue: 42"), missing])'],
  ])("accepts upstream recovery for %s", async (diagnostic, ui) => {
    const rendererParser = createStreamingParser(
      openuiChatLibrary.toJSONSchema(),
      "Card",
    );
    rendererParser.set(ui.slice(0, Math.floor(ui.length / 2)));
    const parsed = rendererParser.set(ui, true);
    expect(parsed.root).toMatchObject({
      typeName: "Card",
      props: {
        children: [{ typeName: "TextContent", props: { text: "Revenue: 42" } }],
      },
    });
    if (diagnostic === "unresolved")
      expect(parsed.meta.unresolved).toEqual(["missing"]);
    else
      expect(parsed.meta.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: diagnostic })]),
      );
    expect(validateOpenUIProgram(ui)).toBe(ui);
    await expect(
      createOpenUITools().present_openui.execute!(
        { ui, text: "Revenue: 42" },
        { toolCallId: "recovered", messages: [], context: {} },
      ),
    ).resolves.toEqual({ displayed: true, text: "Revenue: 42" });
  });
  it.each(['data = Query("load", {})', 'save = Mutation("save", {})'])(
    "still rejects unsupported data sources: %s",
    (statement) => {
      expect(() => validateOpenUIProgram(`${valid}\n${statement}`)).toThrow(
        "Query and Mutation are unavailable",
      );
    },
  );
  it("persists readable content with the successful tool output", async () => {
    const result = await createOpenUITools().present_openui.execute!(
      { ui: valid, text: "Revenue: 42" },
      { toolCallId: "t", messages: [], context: {} },
    );
    expect(result).toEqual({ displayed: true, text: "Revenue: 42" });
    expect(
      groupMessageParts([
        {
          type: OPENUI_TOOL_PART_TYPE,
          toolCallId: "t",
          state: "output-available",
          input: { ui: valid, text: "Revenue: 42" },
          output: result,
        },
      ])[0].kind,
    ).toBe("openui");
  });
  it("lets the real SDK repair a failed call and stops on the successful presentation", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: `t${++calls}`,
            toolName: "present_openui",
            input: JSON.stringify({
              ui: calls === 1 ? " " : valid,
              text: "Revenue: 42",
            }),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool-calls" },
        usage,
        warnings: [],
      }),
    });
    const result = await new ToolLoopAgent({
      model,
      tools: createOpenUITools(),
      stopWhen: [isStepCount(4), hasSuccessfulOpenUI],
    }).generate({ prompt: "Show revenue" });
    expect(calls).toBe(2);
    expect(
      result.steps[0].content.some((part) => part.type === "tool-error"),
    ).toBe(true);
    expect(result.toolResults[0].output).toEqual({
      displayed: true,
      text: "Revenue: 42",
    });
  });
  it.each([
    [{}, false, false],
    [{ openuiEnabled: true, forceOpenUI: true }, false, false],
    [
      { openuiSupported: true, openuiEnabled: false, forceOpenUI: true },
      false,
      true,
    ],
    [{ openuiSupported: true, openuiEnabled: true }, true, false],
  ])(
    "negotiates capability independently from preference: %j",
    async (flags, enabled, forced) => {
      const parsed = await parseChatRequest(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            ...flags,
            chatId: "chat",
            modelConfigId: "model",
            messages: [
              {
                id: "u",
                role: "user",
                parts: [{ type: "text", text: "hello" }],
              },
            ],
          }),
        }),
      );
      expect(parsed.openuiEnabled).toBe(enabled);
      expect(parsed.forceOpenUI).toBe(forced);
    },
  );
});
