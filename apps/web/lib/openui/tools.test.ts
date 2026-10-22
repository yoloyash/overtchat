import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
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
  it("uses the exact renderer spec and keeps the complete prompt under 8000 tokens", () => {
    expect(OPENUI_CHAT_LIBRARY_SPEC).toEqual(openuiChatLibrary.toSpec());
    expect(OPENUI_TOOL_PROMPT).toContain("@ToAssistant");
    expect(OPENUI_TOOL_PROMPT).toContain("text argument");
    // Settings quote about 7,400 tokens; update that copy if this range moves.
    expect(countTextTokens(OPENUI_TOOL_PROMPT)).toBeGreaterThan(6500);
    expect(countTextTokens(OPENUI_TOOL_PROMPT)).toBeLessThan(8000);
  });
  it.each([undefined, null, 123, {}, [], true])(
    "safely ignores malformed streamed arguments: %j",
    (value) => {
      expect(normalizeOpenUILang(value)).toBe("");
    },
  );
  it("normalizes fenced programs and rejects invalid complete programs", () => {
    expect(validateOpenUIProgram("```openui\n" + valid + "\n```")).toBe(valid);
    for (const code of [
      "",
      "This is prose",
      'root = Card([NoSuchComponent("hi")])',
      "root = Card([missing])",
    ]) {
      expect(() => validateOpenUIProgram(code)).toThrow();
    }
  });
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
