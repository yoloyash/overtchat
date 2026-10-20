import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { canContinueMessage, groupMessageParts, joinContinuationTextParts } from "@overtchat/shared";
import { convertToModelMessages } from "ai";

describe("assistant continuation", () => {
  it("requires a text ending and refuses reasoning-only or incomplete tool output", () => {
    const answer: UIMessage = { id: "answer", role: "assistant", parts: [{ type: "text", text: "prefix" }] };
    expect(canContinueMessage(answer)).toBe(true);
    expect(canContinueMessage({ ...answer, role: "user" })).toBe(false);
    expect(canContinueMessage({ ...answer, parts: [{ type: "reasoning", text: "thinking" }] })).toBe(false);
    expect(canContinueMessage({ ...answer, parts: [
      { type: "dynamic-tool", toolName: "lookup", toolCallId: "call", state: "input-streaming" },
      ...answer.parts,
    ] })).toBe(false);
  });

  it("renders continued code and whitespace as one block without changing saved parts", () => {
    const parts: UIMessage["parts"] = [
      { type: "text", text: "```python\ndef answer():" },
      { type: "step-start" },
      { type: "text", text: "\n    " },
      { type: "text", text: "return 42\n```" },
    ];
    const original = structuredClone(parts);
    expect(groupMessageParts(parts)).toEqual([{ kind: "text", index: 0, part: {
      type: "text", text: "```python\ndef answer():\n    return 42\n```",
    } }]);
    expect(parts).toEqual(original);
  });

  it("replays repeated continuations as a single assistant prefix with the real SDK", async () => {
    const parts: UIMessage["parts"] = [
      { type: "text", text: "[1," },
      { type: "step-start" },
      { type: "text", text: "2," },
      { type: "step-start" },
      { type: "text", text: "3," },
    ];
    expect(await convertToModelMessages([{
      role: "assistant", parts: joinContinuationTextParts(parts),
    }])).toEqual([{ role: "assistant", content: [{ type: "text", text: "[1,2,3," }] }]);
    expect(parts).toHaveLength(5);
    const withReasoning: UIMessage["parts"] = [parts[0], parts[1], { type: "reasoning", text: "thinking" }, parts[2]];
    expect(joinContinuationTextParts(withReasoning)).toEqual(withReasoning);
  });
});
