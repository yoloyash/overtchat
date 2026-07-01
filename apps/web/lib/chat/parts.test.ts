import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { groupMessageParts, type Segment } from "./parts";

type Part = UIMessage["parts"][number];

const text = (t: string): Part => ({ type: "text", text: t }) as Part;
const reasoning = (t: string): Part => ({ type: "reasoning", text: t }) as Part;
const search = (query: string): Part =>
  ({
    type: "tool-web_search",
    toolCallId: query,
    state: "output-available",
    input: { query },
    output: [],
  }) as unknown as Part;
const mcpTool = (name: string): Part =>
  ({
    type: `tool-${name}`,
    toolCallId: name,
    state: "output-available",
    input: { city: "Berlin" },
    output: { weather: "clear" },
  }) as unknown as Part;
const dynamicTool = (name: string): Part =>
  ({
    type: "dynamic-tool",
    toolName: name,
    toolCallId: name,
    state: "output-available",
    input: { q: "docs" },
    output: { ok: true },
  }) as unknown as Part;
const file = (): Part =>
  ({ type: "file", mediaType: "image/png", url: "x" }) as Part;

describe("groupMessageParts", () => {
  it("collapses interleaved reasoning + tools into one activity block", () => {
    const segs = groupMessageParts([
      reasoning("a"),
      search("q"),
      reasoning("b"),
      text("answer"),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["activity", "text"]);
    const activity = segs[0] as Extract<Segment, { kind: "activity" }>;
    expect(activity.parts).toHaveLength(3);
    expect(segs[1]).toMatchObject({ kind: "text", index: 3 });
  });

  it("splits into separate blocks when real answer text comes between runs", () => {
    const segs = groupMessageParts([
      reasoning("a"),
      search("q1"),
      text("part 1"),
      reasoning("b"),
      search("q2"),
      text("part 2"),
    ]);
    expect(segs.map((s) => s.kind)).toEqual([
      "activity",
      "text",
      "activity",
      "text",
    ]);
    expect((segs[2] as Extract<Segment, { kind: "activity" }>).startIndex).toBe(
      3,
    );
  });

  it("ignores unknown parts (step-start, files) without breaking a run", () => {
    const segs = groupMessageParts([reasoning("a"), file(), search("q")]);
    expect(segs).toHaveLength(1);
    expect((segs[0] as Extract<Segment, { kind: "activity" }>).parts).toHaveLength(
      2,
    );
  });

  it("does not let a blank text part break an activity run", () => {
    // Multi-step tool calling emits empty `text` parts at step boundaries
    // (text-start/text-end with no delta). They must not split the block.
    const segs = groupMessageParts([
      reasoning("a"),
      search("q1"),
      text(""),
      search("q2"),
      text("   \n  "),
      search("q3"),
      text("real answer"),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["activity", "text"]);
    const activity = segs[0] as Extract<Segment, { kind: "activity" }>;
    expect(activity.parts).toHaveLength(4); // reasoning + 3 searches, blanks dropped
    expect(segs[1]).toMatchObject({ kind: "text", index: 6 });
  });

  it("treats MCP-style static and dynamic tool parts as activity", () => {
    const segs = groupMessageParts([
      reasoning("checking"),
      mcpTool("mcp_docs_search"),
      dynamicTool("mcp_weather_lookup"),
      text("done"),
    ]);
    expect(segs.map((s) => s.kind)).toEqual(["activity", "text"]);
    const activity = segs[0] as Extract<Segment, { kind: "activity" }>;
    expect(activity.parts.map((part) => part.type)).toEqual([
      "reasoning",
      "tool-mcp_docs_search",
      "dynamic-tool",
    ]);
  });
});
