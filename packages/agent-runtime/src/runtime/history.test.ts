import { describe, expect, it } from "vitest";
import {
  agentForkMessageId,
  agentPromptWithHistory,
} from "@overtchat/agent-bridge";
import { buildAgentForkContext } from "@overtchat/shared/agent-history";

describe("fork conversation history", () => {
  it.each([
    ["claude", "Read", { file_path: "src/index.ts" }],
    ["codex", "read", { path: "src/index.ts" }],
    ["pi", "read", { path: "src/index.ts" }],
    ["omp", "read", { path: "src/index.ts" }],
    ["opencode", "read", { filePath: "src/index.ts" }],
  ])(
    "formats %s tool history without raw arguments or results",
    (_provider, name, args) => {
      const context = buildAgentForkContext(
        [
          {
            role: "user",
            content: [
              { type: "text", text: "Check this file" },
              { type: "image", data: "image-data", mimeType: "image/png" },
            ],
          },
          {
            role: "assistant",
            id: "call",
            content: [{ type: "toolCall", id: "read", name, arguments: args }],
          },
          {
            role: "toolResult",
            toolCallId: "read",
            content: [{ type: "text", text: "raw file contents" }],
          },
          {
            role: "assistant",
            id: "answer",
            content: [{ type: "text", text: "Checked." }],
          },
        ],
        "answer",
      );
      expect(context).toContain(
        "[User] Check this file\n[Read] src/index.ts\n[Assistant] Checked.",
      );
      expect(context).not.toContain("Image");
      expect(context).not.toContain("image-data");
      expect(context).not.toContain("raw file contents");
      expect(context).not.toContain(JSON.stringify(args));
      expect(context.match(/\[Read\]/g)).toHaveLength(1);
    },
  );

  it("omits image-only messages and summarizes tool activity in order", () => {
    const context = buildAgentForkContext(
      [
        { role: "user", content: [{ type: "image", data: "image-data" }] },
        {
          role: "assistant",
          id: "answer",
          content: [
            { type: "text", text: "Checking." },
            {
              type: "toolCall",
              id: "shell",
              name: "bash",
              arguments: { command: "npm\n test", timeout: 100 },
            },
            {
              type: "toolCall",
              id: "edit",
              name: "apply_patch",
              arguments: { path: "src/a.ts", patch: "raw patch" },
            },
            {
              type: "toolCall",
              id: "write",
              name: "Write",
              arguments: { file_path: "src/b.ts", content: "raw contents" },
            },
            {
              type: "toolCall",
              id: "search",
              name: "grep",
              arguments: { pattern: "needle" },
            },
            {
              type: "toolCall",
              id: "fetch",
              name: "webfetch",
              arguments: { url: "https://example.com" },
            },
            {
              type: "toolCall",
              id: "external",
              name: "mcp__server__read",
              arguments: { path: "private external input" },
            },
            {
              type: "toolCall",
              id: "unknown",
              name: "custom_tool",
              arguments: { prompt: "private input" },
            },
            { type: "text", text: "Done." },
          ],
        },
      ],
      "answer",
    );
    expect(context).toContain(
      [
        "[Assistant] Checking.",
        "[Shell] npm test",
        "[Edit] src/a.ts",
        "[Write] src/b.ts",
        "[Search] needle",
        "[Fetch] https://example.com",
        "[mcp__server__read]",
        "[custom_tool]",
        "[Assistant] Done.",
      ].join("\n"),
    );
    expect(context).not.toContain("[User]");
    expect(context).not.toMatch(/image-data|raw patch|raw contents|private/);
  });

  it("keeps available sub-agent logs without taking results beyond the boundary", () => {
    const messages = [
      {
        role: "assistant",
        id: "task",
        content: [
          {
            type: "toolCall",
            id: "task",
            name: "Agent",
            arguments: {
              subagent_type: "Explore",
              description: "Inspect the repository",
              prompt: "raw task input",
            },
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "task",
        content: [{ type: "text", text: "Found the entry point." }],
      },
      {
        role: "assistant",
        id: "answer",
        content: [
          {
            type: "subagent",
            id: "child",
            prompt: "Check tests",
            events: ["Ran the tests."],
            receivers: [{ threadId: "child", message: "Tests pass." }],
          },
          { type: "text", text: "Done." },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "task",
        content: [{ type: "text", text: "Later task result" }],
      },
    ];
    const context = buildAgentForkContext(messages, "answer");
    expect(context).toContain(
      "[Explore] Inspect the repository\nFound the entry point.",
    );
    expect(context).toContain(
      "[Task] Check tests\nRan the tests.\nTests pass.",
    );
    expect(context).not.toContain("raw task input");
    expect(context).not.toContain("Later task result");
    expect(buildAgentForkContext(messages, "task")).not.toContain(
      "Found the entry point.",
    );
  });

  it("bounds individual tool summaries and rejects oversized history", () => {
    const context = buildAgentForkContext(
      [
        {
          role: "assistant",
          id: "answer",
          content: [
            {
              type: "toolCall",
              id: "shell",
              name: "bash",
              arguments: { command: "x".repeat(300) },
            },
          ],
        },
      ],
      "answer",
    );
    expect(context).toContain(`[Shell] ${"x".repeat(197)}...`);
    expect(context).not.toContain("x".repeat(198));
    expect(() =>
      buildAgentForkContext(
        [{ role: "assistant", id: "answer", content: "x".repeat(180_001) }],
        "answer",
      ),
    ).toThrow("too large");
  });

  it("cuts history at a selected turn without exporting private reasoning", () => {
    const messages = [
      { role: "user", content: "First request" },
      {
        role: "assistant",
        id: "answer",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "Answer" },
        ],
      },
      { role: "user", content: "Later request" },
    ];
    const context = buildAgentForkContext(messages, "answer");
    expect(context).toContain("[User] First request");
    expect(context).toContain("[Assistant] Answer");
    expect(context).not.toContain("private reasoning");
    expect(context).not.toContain("Later request");
    expect(messages).toHaveLength(3);
    expect(agentPromptWithHistory("Next", context)).toBe(`${context}\n\nNext`);
    expect(() => buildAgentForkContext(messages, "missing")).toThrow(
      "no longer available",
    );
  });
  it("shares the same history boundary for ID-less providers and grouped turns", () => {
    const assistant = {
      role: "assistant",
      timestamp: 123,
      content: [{ type: "text", text: "Hello" }],
    };
    expect(
      buildAgentForkContext([assistant], agentForkMessageId(assistant, 0)),
    ).toContain("Hello");
    expect(
      buildAgentForkContext(
        [
          { ...assistant, overtchatTurnBoundaryId: "turn" },
          { role: "turnFooter", messageId: "turn" },
        ],
        "turn",
      ),
    ).toContain("Hello");
  });
});
