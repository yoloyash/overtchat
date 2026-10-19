import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { openuiChatLibrary } from "@openuidev/react-ui/genui-lib";
import {
  OPENUI_PRESENT_TOOL_NAME,
  OPENUI_TOOL_PART_TYPE,
  groupMessageParts,
  normalizeOpenUILang,
} from "@overtchat/shared";
import { extractFormFields } from "@/components/chat/OpenUIRenderer";
import { parseChatRequest } from "@/lib/chat/request";
import {
  OPENUI_CHAT_LIBRARY_SPEC,
  OPENUI_TOOL_PROMPT,
  createOpenUITools,
} from "./tools";

describe("OpenUI integration", () => {
  it("keeps the server chat library spec in sync with @openuidev/react-ui", () => {
    expect(OPENUI_CHAT_LIBRARY_SPEC).toEqual(openuiChatLibrary.toSpec());
    expect(OPENUI_TOOL_PROMPT).toContain(OPENUI_PRESENT_TOOL_NAME);
    expect(OPENUI_TOOL_PROMPT).toContain("root = Card");
    expect(OPENUI_TOOL_PROMPT).not.toContain(
      "Your ENTIRE response must be valid openui-lang code",
    );
  });

  it("strips accidental markdown code fences from OpenUI Lang strings", () => {
    const raw = "```openui\nroot = Card([title])\ntitle = TextContent(\"Hi\")\n```";
    expect(normalizeOpenUILang(raw)).toBe(
      'root = Card([title])\ntitle = TextContent("Hi")',
    );
    expect(normalizeOpenUILang('root = Card([title])')).toBe(
      "root = Card([title])",
    );
  });

  it("validates non-empty OpenUI programs in present_openui execute", async () => {
    const toolDef = createOpenUITools()[OPENUI_PRESENT_TOOL_NAME];
    await expect(
      toolDef.execute!(
        { ui: 'root = Card([TextContent("Hello")])' },
        { toolCallId: "tc-1", messages: [], context: {} },
      ),
    ).resolves.toEqual({ displayed: true });
    await expect(
      toolDef.execute!(
        { ui: "   " },
        { toolCallId: "tc-2", messages: [], context: {} },
      ),
    ).rejects.toThrow("OpenUI program cannot be empty.");
  });

  it("groups tool-present_openui parts into openui message segments", () => {
    const segments = groupMessageParts([
      { type: "text", text: "Here is the breakdown:" },
      {
        type: OPENUI_TOOL_PART_TYPE,
        toolCallId: "call_1",
        state: "output-available",
        input: { ui: 'root = Card([TextContent("Revenue")])' },
        output: { displayed: true },
      },
    ]);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.kind).toBe("text");
    expect(segments[1]).toMatchObject({
      kind: "openui",
      part: {
        type: OPENUI_TOOL_PART_TYPE,
        toolCallId: "call_1",
      },
    });
  });

  it("unwraps nested OpenUI store form field wrappers into clean key-value pairs", () => {
    expect(
      extractFormFields({
        tripForm: {
          destination: { value: "Kyoto", componentType: "Input" },
          style: { value: "Cultural", componentType: "OptionCards" },
          emptyField: { value: "", componentType: "Input" },
        },
        $budget: 2500,
      }),
    ).toEqual([
      ["destination", "Kyoto"],
      ["style", "Cultural"],
      ["$budget", 2500],
    ]);
  });

  it("allows per-message forceOpenUI even when global openuiEnabled is false", async () => {
    const req = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelConfigId: "model-1",
        chatId: "chat-1",
        openuiEnabled: false,
        forceOpenUI: true,
        messages: [
          {
            id: "msg-1",
            role: "user",
            parts: [{ type: "text", text: "Build a trip form" }],
          },
        ],
      }),
    });
    const parsed = await parseChatRequest(req);
    expect(parsed.openuiEnabled).toBe(false);
    expect(parsed.forceOpenUI).toBe(true);
  });
});
