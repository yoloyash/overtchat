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
import { withOpenUIActionContext, withSubmittedOpenUIAction } from "./actions";
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
