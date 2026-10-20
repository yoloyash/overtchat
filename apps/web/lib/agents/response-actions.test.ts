import { describe, expect, it } from "vitest";
import { agentResponseActions, projectAgentTranscript } from "./presentation";

const user = (id: string) => ({ role: "user", id, content: id });
const text = (id: string, extra = {}) => ({
  role: "assistant", id, content: [{ type: "text", text: id }], ...extra,
});
const tool = {
  role: "assistant", id: "tool",
  content: [{ type: "toolCall", id: "call", name: "bash", arguments: {} }],
};
const actions = (messages: unknown[], unsettled = false) =>
  [...agentResponseActions(projectAgentTranscript(messages), unsettled).values()];

describe("agent response actions", () => {
  it("assigns actions only to the completed response, not progress updates", () => {
    const messages = [user("u"), text("progress"), tool, text("answer")];
    expect(actions(messages)).toEqual([{ text: "answer", messageId: "answer" }]);
    expect(actions(messages, true)).toEqual([]);
    expect(actions([...messages, user("next"), text("working")], true))
      .toEqual([{ text: "answer", messageId: "answer" }]);
  });

  it("copies and reads all final response blocks once", () => {
    expect(actions([text("response", { content: [
      { type: "text", text: "Checking" },
      ...tool.content,
      { type: "text", text: "Summary" },
      { type: "thinking", thinking: "Check" },
      { type: "text", text: "Details" },
    ] })])).toEqual([{ text: "Summary\n\nDetails", messageId: "response" }]);
  });

  it("gives explicit footers sole ownership even without a fork boundary", () => {
    const messages = [user("u"), text("progress"), text("answer")];
    for (const messageId of ["boundary", null]) {
      const projected = projectAgentTranscript([...messages, {
        role: "turnFooter", content: "Full response", messageId,
      }]);
      const result = agentResponseActions(projected, true);
      expect([...result.keys()]).toEqual([projected.at(-1)!.key]);
      expect([...result.values()]).toEqual([{ text: "Full response", messageId }]);
    }
  });

  it("does not promote commentary or progress followed by tools to a final response", () => {
    expect(actions([user("u"), text("progress"), tool])).toEqual([]);
    expect(actions([text("progress", {
      content: [{ type: "text", text: "Working", phase: "commentary" }],
    })])).toEqual([]);
  });

  it("respects native turn boundaries and steering within a running turn", () => {
    const native = (id: string, turnId: string) => text(id, { overtchatTurnId: turnId });
    const messages = [native("old", "one"), native("progress", "two"),
      { ...user("steer"), overtchatTurnId: "two" }, native("answer", "two")];
    expect(actions(messages, true)).toEqual([{ text: "old", messageId: "old" }]);
    expect(actions(messages.slice(0, -1), true)).toEqual([{ text: "old", messageId: "old" }]);
    expect(actions(messages)).toEqual([
      { text: "old", messageId: "old" }, { text: "answer", messageId: "answer" },
    ]);
    expect(actions([...messages, {
      role: "turnFooter", overtchatTurnId: "two", content: "Complete", messageId: "boundary",
    }])).toEqual([{ text: "old", messageId: "old" }, { text: "Complete", messageId: "boundary" }]);
    expect(actions([native("old", "one"), native("answer", "two")]))
      .toEqual([{ text: "old", messageId: "old" }, { text: "answer", messageId: "answer" }]);
  });

  it("combines explicit final phases without enabling unsupported forks", () => {
    const messages = ["Summary", "Details"].map((id) => text(id, {
      overtchatTurnBoundaryId: "boundary",
      content: [{ type: "text", text: id, phase: "final_answer" }],
    }));
    expect(actions(messages)).toEqual([{ text: "Summary\n\nDetails", messageId: null }]);
  });
});
