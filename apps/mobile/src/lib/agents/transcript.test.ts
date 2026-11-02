import { describe, expect, it } from "vitest";
import type { AgentTranscriptItem } from "@overtchat/shared/agent-presentation";
import { formatAgentElapsed, stabilizeTranscriptItems } from "./transcript";

describe("stable transcript rows", () => {
  const text = (key: string, value: string): AgentTranscriptItem => ({
    type: "assistant_text",
    key,
    text: value,
    messageId: key,
    actionable: false,
  });

  it("reuses unchanged rows so only changed rows render again", () => {
    const first = stabilizeTranscriptItems(new Map(), [text("a", "One"), text("b", "Two")]);
    const second = stabilizeTranscriptItems(first.byKey, [
      text("a", "One"),
      text("b", "Two, streaming"),
      text("c", "Three"),
    ]);
    expect(second.items[0]).toBe(first.items[0]);
    expect(second.items[1]).not.toBe(first.items[1]);
    expect(second.items[1]).toMatchObject({ text: "Two, streaming" });
    expect([...second.byKey.keys()]).toEqual(["a", "b", "c"]);
  });

  it("compares nested activity entries by value", () => {
    const activity = (output: string): AgentTranscriptItem => ({
      type: "activity",
      key: "activity:call",
      entries: [
        {
          type: "tool",
          id: "call",
          tool: {
            id: "call",
            name: "bash",
            args: { command: "ls" },
            output,
            hasResult: true,
            partial: false,
            isError: false,
            direct: false,
            exitCode: 0,
            cancelled: false,
            truncated: false,
            fullOutputPath: null,
            terminalInputs: [],
          },
        },
      ],
    });
    const first = stabilizeTranscriptItems(new Map(), [activity("a.txt")]);
    expect(stabilizeTranscriptItems(first.byKey, [activity("a.txt")]).items[0]).toBe(
      first.items[0],
    );
    expect(
      stabilizeTranscriptItems(first.byKey, [activity("a.txt\nb.txt")]).items[0],
    ).not.toBe(first.items[0]);
  });
});

describe("elapsed time", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatAgentElapsed(-5)).toBe("0s");
    expect(formatAgentElapsed(42_400)).toBe("42s");
    expect(formatAgentElapsed(65_000)).toBe("1m 5s");
    expect(formatAgentElapsed(2 * 3600_000 + 3 * 60_000)).toBe("2h 3m");
  });
});
