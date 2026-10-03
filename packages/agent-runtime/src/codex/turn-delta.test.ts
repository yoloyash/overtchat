import { describe, expect, it } from "vitest";
import { applyAgentTurnDelta, isAgentTurnDelta } from "@overtchat/agent-bridge";
import { codexTurnDelta } from "./turn-delta";
const message = (id: string, role: string, content: unknown) => ({
  id,
  role,
  overtchatTurnId: "turn",
  content,
});

describe("Codex incremental turn projection", () => {
  it("streams text without resending previous multi-megabyte tool output", () => {
    const previous = [
      message("user", "user", "Inspect"),
      message("tool", "toolResult", [
        { type: "text", text: "x".repeat(3_000_000) },
      ]),
      message("answer", "assistant", [{ type: "text", text: "Hello" }]),
    ];
    const next = [
      previous[0],
      previous[1],
      message("answer", "assistant", [
        { type: "text", text: "Hello world 😀" },
      ]),
    ];
    const delta = codexTurnDelta("turn", previous, next);
    expect(isAgentTurnDelta(delta)).toBe(true);
    expect(delta.messages).toEqual([]);
    expect(delta.textDeltas).toEqual([
      { id: "answer", part: 0, field: "text", offset: 5, text: " world 😀" },
    ]);
    expect(Buffer.byteLength(JSON.stringify(delta))).toBeLessThan(500);
    expect(applyAgentTurnDelta(previous, delta)).toEqual(next);
    expect(previous[2]!.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(applyAgentTurnDelta(next, delta)).toBeNull();
  });

  it("reconstructs starts, metadata changes, corrections, removals, ordering, and completion", () => {
    const revisions = [
      [message("user", "user", "Inspect")],
      [
        message("user", "user", "Inspect"),
        message("text", "assistant", [{ type: "text", text: "A" }]),
      ],
      [
        message("user", "user", "Inspect"),
        message("text", "assistant", [
          { type: "text", text: "AB", phase: "final_answer" },
        ]),
        message("tool", "toolResult", [{ type: "text", text: "running" }]),
      ],
      [
        message("user", "user", "Inspect"),
        message("tool", "toolResult", [{ type: "text", text: "running…done" }]),
        message("text", "assistant", [{ type: "text", text: "Corrected" }]),
      ],
      [
        message("user", "user", "Inspect"),
        message("text", "assistant", [{ type: "text", text: "Corrected" }]),
        message("footer", "turnFooter", "Corrected"),
      ],
    ];
    let current: unknown[] = [];
    for (const next of revisions) {
      const delta = codexTurnDelta("turn", current, next);
      expect(isAgentTurnDelta(delta)).toBe(true);
      current = applyAgentTurnDelta(current, delta)!;
      expect(current).toEqual(next);
    }
    const delta = codexTurnDelta("turn", current, current);
    expect(delta.messages).toEqual([]);
    expect(delta.textDeltas).toEqual([]);
    expect(applyAgentTurnDelta([], delta)).toBeNull();
  });
});
