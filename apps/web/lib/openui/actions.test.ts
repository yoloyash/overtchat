import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { UIMessage } from "ai";
import {
  collectOpenUIStates,
  openUIStateKey,
  readOpenUIAction,
  readableMessageText,
  withOpenUIFallback,
} from "@overtchat/shared";
import {
  withOpenUIActionContext,
  withRecentOpenUIPrograms,
  withSubmittedOpenUIAction,
} from "./actions";
import { extractSearchText } from "@/lib/search/extract";
import { speakableText } from "@/lib/chat/message";
const source: UIMessage = {
  id: "a",
  role: "assistant",
  parts: [
    {
      type: "tool-present_openui",
      toolCallId: "t",
      state: "output-available",
      input: { ui: 'root = Card([TextContent("Revenue: 42")])' },
      output: { displayed: true, text: "Revenue: 42" },
    },
  ],
};
const user: UIMessage = {
  id: "u",
  role: "user",
  parts: [{ type: "text", text: "Details" }],
};
const action = {
  messageId: "a",
  toolCallId: "t",
  message: "Details",
  context: { orderId: 42 },
  formName: "trip",
  formState: { trip: { destination: { value: "Kyoto" } } },
};
describe("OpenUI actions and message consumers", () => {
  it("keeps the display label clean while delivering context and form identity to the model", () => {
    const messages = withSubmittedOpenUIAction([source, user], action);
    expect(readableMessageText(messages[1])).toBe("Details");
    expect(readableMessageText(withOpenUIActionContext(messages)[1])).toContain(
      '"orderId":42',
    );
    expect(
      collectOpenUIStates(JSON.parse(JSON.stringify(messages))).get(
        openUIStateKey("a", "t"),
      ),
    ).toEqual(action.formState);
  });
  it("rejects a missing source, and ignores unvalidated incoming metadata", () => {
    expect(() => withSubmittedOpenUIAction([user], action)).toThrow(
      "no longer available",
    );
    expect(
      withSubmittedOpenUIAction([
        { ...user, metadata: { openuiAction: action } },
      ])[0].metadata,
    ).toEqual({});
    expect(
      readOpenUIAction({ ...action, context: { nest: "x".repeat(70000) } }),
    ).toBeUndefined();
  });
  it("provides copy, speech, FTS and legacy history without losing canonical parts", () => {
    expect(readableMessageText(source).trim()).toBe("Revenue: 42");
    expect(speakableText(source)).toBe("Revenue: 42");
    expect(extractSearchText(source.parts)).toBe("Revenue: 42");
    expect(withOpenUIFallback([source])[0].parts).toEqual([
      { type: "text", text: "Revenue: 42" },
    ]);
    expect(source.parts[0].type).toBe("tool-present_openui");
  });
});

describe("OpenUI model history", () => {
  const card = (id: string, ui: string, text: string) => ({
    type: "tool-present_openui" as const,
    toolCallId: id,
    state: "output-available" as const,
    input: { ui, text },
    output: { displayed: true as const, text },
  });
  const turn = (id: string, parts: UIMessage["parts"]): UIMessage => ({
    id,
    role: "assistant",
    parts,
  });
  it("replays only recent programs and keeps older cards as readable text", () => {
    const failed = {
      type: "tool-present_openui" as const,
      toolCallId: "bad",
      state: "output-error" as const,
      input: { ui: "root = Card([missing])", text: "Draft" },
      errorText: "Invalid OpenUI program.",
    };
    const history = [
      turn("a1", [{ type: "text", text: "Intro" }, card("c1", "P1", "One")]),
      user,
      turn("a2", [failed, card("c2", "P2", "Two")]),
      user,
      turn("a3", [card("c3", "P3", "Three")]),
      user,
    ];
    const compacted = withRecentOpenUIPrograms(history);
    expect(compacted[0].parts).toEqual([
      { type: "text", text: "Intro" },
      { type: "text", text: "\nOne\n" },
    ]);
    expect(compacted[2].parts).toEqual([card("c2", "P2", "Two")]);
    expect(compacted[4].parts).toEqual([card("c3", "P3", "Three")]);
    expect(history[0].parts[1]).toEqual(card("c1", "P1", "One"));
  });
  it("leaves the latest message intact for continuation", () => {
    const last = turn("a", [card("c1", "P1", "One")]);
    expect(withRecentOpenUIPrograms([last], 0)).toEqual([last]);
  });
});
