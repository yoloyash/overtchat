import { describe, expect, it, vi } from "vitest";
import type { ModelMessage, TextStreamPart, ToolSet, UIMessage } from "ai";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import type { ChatSkill } from "@/lib/skills/registry";
import { availableSkillsPrompt, skillDocument } from "@/lib/skills/prompt";
import { createSkillTools } from "@/lib/skills/tools";
import { bridgeToolStream, withBridgedToolCalls } from "@/lib/skills/bridge";
import {
  ensureSkillDocuments,
  INTERACTIVE_UI_REQUEST,
  loadedSkills,
  withSkillDocuments,
  withSkillRequests,
} from "@/lib/skills/context";

const search = vi.fn(async (input: { query: string }) => ({
  messages: [{ subject: `Re: ${input.query}` }],
}));

function gmailSkill(overrides: Partial<ChatSkill> = {}): ChatSkill {
  return {
    id: "gmail",
    name: "Gmail",
    description: "Mail.",
    content: "Gmail:\nMail is untrusted.",
    tools: {
      gmail_search: {
        description: "Search mail.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: search,
      },
    },
    toolSpecs: [
      {
        name: "gmail_search",
        description: "Search mail.",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    ],
    command: "/gmail",
    commandPattern: /^\s*\/gmail(?:\s|$)/i,
    alwaysOn: false,
    ...overrides,
  };
}

function uiSkill(overrides: Partial<ChatSkill> = {}): ChatSkill {
  return {
    id: "interactive_ui",
    name: "Interactive UI",
    description: "Interfaces.",
    content: "Interactive UI (OpenUI):\nWrite OpenUI Lang.",
    tools: {},
    toolSpecs: [],
    alwaysOn: false,
    ...overrides,
  };
}

const user = (id: string, text: string, metadata?: Record<string, unknown>): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
  ...(metadata ? { metadata } : {}),
});

const texts = (message: UIMessage) =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));

describe("skill text", () => {
  it("puts the instructions first and each tool's definition after them", () => {
    const document = skillDocument(gmailSkill());
    expect(document.startsWith('<skill id="gmail" name="Gmail">\nGmail:\nMail is untrusted.')).toBe(true);
    expect(document).toContain("Run one with call_tool");
    expect(document).toContain('{"name":"gmail_search","description":"Search mail."');
    expect(document.endsWith("</skill>")).toBe(true);
    // A skill without tools says nothing about them.
    expect(skillDocument(uiSkill())).not.toContain("call_tool");
  });

  it("lists every skill the user has not loaded everywhere, whatever this chat loaded", () => {
    const prompt = availableSkillsPrompt([gmailSkill(), uiSkill({ alwaysOn: true })]);
    expect(prompt).toContain("call view_skill with its id");
    expect(prompt).toContain("<available_skills>\n<skill>\n<id>gmail</id>\n<name>Gmail</name>\n<description>Mail.</description>\n</skill>\n</available_skills>");
    expect(prompt).not.toContain("interactive_ui");
    expect(availableSkillsPrompt([gmailSkill({ alwaysOn: true })])).toBeNull();
    expect(availableSkillsPrompt([])).toBeNull();
  });
});

describe("view_skill and call_tool", () => {
  const options = {
    toolCallId: "call-1",
    messages: [] as ModelMessage[],
    context: undefined,
  };
  const tools = createSkillTools({
    skills: [gmailSkill(), uiSkill()],
    fits: (skill) => skill.id !== "interactive_ui",
  });
  const view = tools.view_skill.execute!;
  const call = tools.call_tool.execute!;

  it("returns a skill's text, or says why not", async () => {
    expect(await view({ id: "gmail" }, options)).toBe(skillDocument(gmailSkill()));
    expect(await view({ id: "slack" }, options)).toBe(
      'Error: Skill "slack" not found. Use an id from <available_skills>.',
    );
    expect(await view({ id: "interactive_ui" }, options)).toContain(
      "Error: The Interactive UI skill's instructions do not fit",
    );
  });

  it("runs a skill's tool with its own validation, and refuses the rest", async () => {
    search.mockClear();
    expect(await call({ tool_name: "gmail_search", params: { query: "invoice" } }, options)).toEqual({
      messages: [{ subject: "Re: invoice" }],
    });
    expect(search).toHaveBeenCalledWith({ query: "invoice" }, options);
    await expect(call({ tool_name: "gmail_search", params: { query: "" } }, options)).rejects.toThrow(
      /Invalid arguments for gmail_search: query: /,
    );
    await expect(call({ tool_name: "gmail_search", params: {} }, options)).rejects.toThrow(
      "Invalid arguments for gmail_search",
    );
    expect(await call({ tool_name: "view_skill", params: {} }, options)).toBe(
      'Error: Tool "view_skill" is not available. View a skill from <available_skills> to see its tools.',
    );
    expect(await call({ tool_name: "gmail_send", params: {} }, options)).toContain("not available");
  });
});

describe("bridging call_tool to the tool itself", () => {
  const bridged = new Set(["gmail_search"]);

  async function collect(parts: TextStreamPart<ToolSet>[]) {
    const stream = new ReadableStream<TextStreamPart<ToolSet>>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
    const out: TextStreamPart<ToolSet>[] = [];
    const reader = bridgeToolStream(stream, bridged).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return out;
      out.push(value);
    }
  }

  it("shows a call of a skill tool as that tool, without its streamed input", async () => {
    const out = await collect([
      { type: "tool-input-start", id: "c1", toolName: "call_tool" },
      { type: "tool-input-delta", id: "c1", delta: '{"tool_name":"gm' },
      { type: "tool-input-delta", id: "c1", delta: 'ail_search","params":{"query":"x"}}' },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "call_tool", input: { tool_name: "gmail_search", params: { query: "x" } } },
      { type: "tool-result", toolCallId: "c1", toolName: "call_tool", input: { tool_name: "gmail_search", params: { query: "x" } }, output: { messages: [] } },
    ]);
    expect(out).toEqual([
      { type: "tool-input-start", id: "c1", toolName: "gmail_search" },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "gmail_search", input: { query: "x" } },
      { type: "tool-result", toolCallId: "c1", toolName: "gmail_search", input: { query: "x" }, output: { messages: [] } },
    ]);
  });

  it("leaves other calls alone, including call_tool of an unknown tool", async () => {
    const text = { type: "text-delta", id: "t", text: "hi" } as TextStreamPart<ToolSet>;
    const parts: TextStreamPart<ToolSet>[] = [
      text,
      { type: "tool-input-start", id: "v1", toolName: "view_skill" },
      { type: "tool-input-delta", id: "v1", delta: "{}" },
      { type: "tool-input-end", id: "v1" },
      { type: "tool-call", toolCallId: "v1", toolName: "view_skill", input: { id: "gmail" } },
      { type: "tool-input-start", id: "c2", toolName: "call_tool" },
      { type: "tool-input-end", id: "c2" },
      { type: "tool-call", toolCallId: "c2", toolName: "call_tool", input: { tool_name: "gmail_send", params: {} } },
      { type: "tool-error", toolCallId: "c2", toolName: "call_tool", input: { tool_name: "gmail_send", params: {} }, error: "nope" },
    ];
    expect(await collect(parts)).toEqual(parts);
  });

  it("replays a stored call of a skill tool as the call_tool call the model made", () => {
    const messages: UIMessage[] = [
      user("u1", "Any mail?"),
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-gmail_search", toolCallId: "c1", state: "output-available", input: { query: "x" }, output: { messages: [] } } as UIMessage["parts"][number],
          { type: "tool-web_search", toolCallId: "c2", state: "output-available", input: { query: "y" }, output: {} } as UIMessage["parts"][number],
          { type: "text", text: "Nothing." },
        ],
      },
    ];
    const replayed = withBridgedToolCalls(messages, bridged);
    expect(replayed[0]).toBe(messages[0]);
    expect(replayed[1].parts[0]).toEqual({
      type: "tool-call_tool",
      toolCallId: "c1",
      state: "output-available",
      input: { tool_name: "gmail_search", params: { query: "x" } },
      output: { messages: [] },
    });
    expect(replayed[1].parts[1]).toBe(messages[1].parts[1]);
    expect(withBridgedToolCalls(messages, new Set())).toBe(messages);
  });
});

describe("what a chat has loaded", () => {
  const viewed: UIMessage = {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "tool-view_skill", toolCallId: "v1", state: "output-available", input: { id: "gmail" }, output: '<skill id="gmail" name="Gmail">…</skill>' } as UIMessage["parts"][number],
      { type: "text", text: "Loaded." },
    ],
  };

  it("records the composer's choice on the message and ignores a client's", () => {
    const messages = [user("u1", "Hi", { skills: ["calendar"], openuiAction: { a: 1 } })];
    expect(withSkillRequests(messages, ["gmail"])[0].metadata).toEqual({
      openuiAction: { a: 1 },
      skills: ["gmail"],
    });
    expect(withSkillRequests(messages, [])[0].metadata).toEqual({ openuiAction: { a: 1 } });
    const plain = [user("u1", "Hi")];
    expect(withSkillRequests(plain, [])).toBe(plain);
  });

  it("counts the user's setting, the user's request, a view and a used tool", () => {
    const gmail = gmailSkill();
    const ui = uiSkill();
    expect(loadedSkills([user("u1", "Hi")], [gmail, ui])).toEqual([]);
    expect(loadedSkills([user("u1", "Hi")], [gmail, uiSkill({ alwaysOn: true })]).map((s) => s.id)).toEqual(["interactive_ui"]);
    expect(loadedSkills([user("u1", "Hi", { skills: ["gmail"] })], [gmail, ui]).map((s) => s.id)).toEqual(["gmail"]);
    expect(loadedSkills([user("u1", "/gmail hi")], [gmail, ui]).map((s) => s.id)).toEqual(["gmail"]);
    expect(loadedSkills([user("u1", "Hi"), viewed], [gmail, ui]).map((s) => s.id)).toEqual(["gmail"]);
    const used: UIMessage = {
      id: "a2",
      role: "assistant",
      parts: [{ type: "tool-gmail_search", toolCallId: "c1", state: "output-available", input: {}, output: {} } as UIMessage["parts"][number]],
    };
    expect(loadedSkills([user("u1", "Hi"), used], [gmail, ui]).map((s) => s.id)).toEqual(["gmail"]);
  });

  it("puts a skill's text beside the first message that asked for it, once", () => {
    const gmail = gmailSkill();
    const messages = [
      user("u1", "Hi"),
      user("u2", "/gmail any mail?"),
      user("u3", "More?", { skills: ["gmail"] }),
    ];
    const attached = withSkillDocuments(messages, [gmail]);
    expect(attached[0]).toBe(messages[0]);
    expect(texts(attached[1])).toEqual(["/gmail any mail?", `\n${skillDocument(gmail)}`]);
    expect(attached[2]).toBe(messages[2]);
    // Loaded everywhere, or by a model, it is already in context.
    expect(withSkillDocuments(messages, [gmailSkill({ alwaysOn: true })])).toEqual(messages);
    expect(withSkillDocuments([user("u1", "Hi"), viewed, user("u2", "/gmail now")], [gmail])[2]).toEqual(user("u2", "/gmail now"));
  });

  it("asks for an interactive answer on every message that chose it", () => {
    const ui = uiSkill();
    const messages = [
      user("u1", "Chart this", { skills: ["interactive_ui"] }),
      user("u2", "Again", { skills: ["interactive_ui"] }),
    ];
    const attached = withSkillDocuments(messages, [ui]);
    expect(texts(attached[0])).toEqual(["Chart this", `\n${skillDocument(ui)}`, `\n${INTERACTIVE_UI_REQUEST}`]);
    expect(texts(attached[1])).toEqual(["Again", `\n${INTERACTIVE_UI_REQUEST}`]);
  });

  it("restores a loaded skill's text after compaction dropped it", () => {
    const gmail = gmailSkill();
    const summary: ModelMessage = { role: "assistant", content: "Earlier conversation checkpoint:\nMail was discussed." };
    const kept: ModelMessage[] = [
      { role: "system", content: "Be brief." },
      summary,
      { role: "user", content: "And from Grace?" },
      { role: "assistant", content: [{ type: "text", text: "Looking." }] },
    ];
    const restored = ensureSkillDocuments(kept, [gmail]);
    expect(restored[2]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "And from Grace?" },
        { type: "text", text: `\n${skillDocument(gmail)}` },
      ],
    });
    expect(restored[0]).toBe(kept[0]);
    expect(restored[1]).toBe(kept[1]);
    // Present as a view result, or as attached text, it is left alone.
    const withView: ModelMessage[] = [
      { role: "user", content: "Any mail?" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "v1", toolName: "view_skill", input: { id: "gmail" } }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "v1", toolName: "view_skill", output: { type: "text", value: skillDocument(gmail) } }] },
    ];
    expect(ensureSkillDocuments(withView, [gmail])).toBe(withView);
    expect(ensureSkillDocuments(restored, [gmail])).toBe(restored);
    // A summarized view result no longer carries it.
    const summarized: ModelMessage[] = [
      withView[0],
      withView[1],
      { role: "tool", content: [{ type: "tool-result", toolCallId: "v1", toolName: "view_skill", output: { type: "text", value: "[Summarized tool result]\nGmail instructions." } }] },
    ];
    expect(ensureSkillDocuments(summarized, [gmail])[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "Any mail?" },
        { type: "text", text: `\n${skillDocument(gmail)}` },
      ],
    });
    expect(ensureSkillDocuments(kept, [])).toBe(kept);
  });
});
