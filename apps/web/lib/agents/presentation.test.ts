import { describe, expect, it } from "vitest";
import {
  agentActivitySequencePosition,
  agentToolStatus,
  describeAgentActivity,
  describeAgentTool,
  formatAgentToolDetail,
  presentAgentError,
  projectAgentTranscript,
  type AgentToolActivity,
} from "./presentation";

function assistant(
  content: unknown[],
  timestamp: number,
  extra: Record<string, unknown> = {},
) {
  return {
    role: "assistant",
    content,
    timestamp,
    usage: {
      input: 48_088,
      output: 94,
      cost: { total: 0 },
    },
    ...extra,
  };
}

function call(id: string, name: string, args: unknown) {
  return { type: "toolCall", id, name, arguments: args };
}

function result(
  id: string,
  name: string,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    ...extra,
  };
}

function projectedTools(messages: unknown[]) {
  const activity = projectAgentTranscript(messages).find(
    (item) => item.type === "activity",
  );
  if (!activity || activity.type !== "activity") {
    throw new Error("Expected an activity group");
  }
  return activity.entries.flatMap((entry) =>
    entry.type === "tool" ? [entry.tool] : [],
  );
}

describe("projectAgentTranscript", () => {
  it("keeps reasoning distinct while grouping consecutive tool activity", () => {
    const projected = projectAgentTranscript([
      { role: "user", content: "Remove the old image", timestamp: 1 },
      assistant(
        [
          { type: "thinking", thinking: "I will inspect the images." },
          call("inspect", "bash", {
            command: "docker images ghcr.io/example/app",
          }),
        ],
        2,
      ),
      result("inspect", "bash", "0.11.2 abc\n0.11.4 def"),
      assistant(
        [
          call("remove", "bash", {
            command: "docker rmi abc",
          }),
        ],
        3,
      ),
      result("remove", "bash", "Deleted: sha256:abc"),
      assistant(
        [{ type: "text", text: "Removed the old image." }],
        4,
      ),
    ]);

    expect(projected.map((item) => item.type)).toEqual([
      "message",
      "activity",
      "activity",
      "assistant_text",
    ]);
    expect(projected.slice(1, 3)).toEqual([
      expect.objectContaining({
        type: "activity",
        entries: [expect.objectContaining({ type: "thinking" })],
      }),
      expect.objectContaining({
        type: "activity",
        key: "activity:tool:inspect",
        entries: [
          expect.objectContaining({
            type: "tool",
            tool: expect.objectContaining({
              id: "inspect",
              output: "0.11.2 abc\n0.11.4 def",
              hasResult: true,
            }),
          }),
          expect.objectContaining({
            type: "tool",
            tool: expect.objectContaining({
              id: "remove",
              output: "Deleted: sha256:abc",
              hasResult: true,
            }),
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(projected)).not.toContain("48,088");
  });

  it("uses visible assistant text as an activity boundary", () => {
    const projected = projectAgentTranscript([
      assistant(
        [
          call("first", "read", { path: "a.ts" }),
          { type: "text", text: "I found the first reference." },
          call("second", "read", { path: "b.ts" }),
        ],
        1,
      ),
      result("first", "read", "a"),
      result("second", "read", "b"),
    ]);

    expect(projected.map((item) => item.type)).toEqual([
      "activity",
      "assistant_text",
      "activity",
    ]);
  });

  it("uses reasoning and subagent activity as tool-group boundaries", () => {
    const projected = projectAgentTranscript([
      assistant([call("first", "bash", { command: "one" })], 1),
      result("first", "bash", "one"),
      assistant(
        [
          { type: "thinking", thinking: "I should delegate this." },
          {
            type: "subagent",
            id: "child",
            action: "spawnAgent",
            status: "completed",
            receivers: [],
            events: [],
          },
        ],
        2,
      ),
      assistant([call("second", "bash", { command: "two" })], 3),
      result("second", "bash", "two"),
    ]);

    expect(
      projected.map((item) =>
        item.type === "activity"
          ? item.entries.map((entry) => entry.type)
          : item.type,
      ),
    ).toEqual([["tool"], ["thinking"], ["subagent"], ["tool"]]);
  });

  it("keeps commentary inline and puts timing on the turn footer", () => {
    const projected = projectAgentTranscript([
      assistant(
        [
          {
            type: "commentary",
            text: "I'm checking the release image.",
          },
          call("build", "bash", { command: "docker build ." }),
          { type: "text", text: "The image is ready." },
        ],
        1,
        {
          id: "turn-1:assistant",
        },
      ),
      result("build", "bash", "done"),
      {
        id: "turn-1:footer",
        role: "turnFooter",
        messageId: "turn-1:assistant",
        content: "I'm checking the release image.\n\nThe image is ready.",
        durationMs: 246_355,
      },
    ]);

    expect(projected).toEqual([
      expect.objectContaining({
        type: "assistant_text",
        text: "I'm checking the release image.",
        actionable: false,
      }),
      expect.objectContaining({
        type: "activity",
        entries: [
          expect.objectContaining({
            type: "tool",
            tool: expect.objectContaining({ id: "build", output: "done" }),
          }),
        ],
      }),
      expect.objectContaining({
        type: "assistant_text",
        text: "The image is ready.",
        actionable: false,
      }),
      {
        type: "turn_footer",
        key: "turn-footer:turn-1:footer",
        text: "I'm checking the release image.\n\nThe image is ready.",
        durationMs: 246_355,
        messageId: "turn-1:assistant",
      },
    ]);
  });

  it("exposes one fork action on the final assistant text part", () => {
    const projected = projectAgentTranscript([
      assistant(
        [
          { type: "text", text: "First update." },
          call("inspect", "read", { path: "a.ts" }),
          { type: "text", text: "Final answer." },
        ],
        1,
        { id: "turn-1:assistant" },
      ),
    ]);
    const textItems = projected.filter(
      (item) => item.type === "assistant_text",
    );

    expect(textItems).toEqual([
      expect.objectContaining({
        text: "First update.",
        messageId: "turn-1:assistant",
        actionable: false,
      }),
      expect.objectContaining({
        text: "Final answer.",
        messageId: "turn-1:assistant",
        actionable: true,
      }),
    ]);
  });

  it("keeps partial, failed, and orphaned results inspectable", () => {
    const partial = projectedTools([
      assistant([call("partial", "bash", { command: "npm test" })], 1),
      result("partial", "bash", "running", { overtchatPartial: true }),
    ])[0];
    expect(agentToolStatus(partial, true)).toBe("running");

    const failed = projectedTools([
      assistant([call("failed", "bash", { command: "npm test" })], 1),
      result("failed", "bash", "failed", { isError: true }),
    ])[0];
    expect(agentToolStatus(failed, false)).toBe("failed");

    const orphaned = projectedTools([
      result("orphaned", "custom_tool", "still visible"),
    ])[0];
    expect(orphaned).toMatchObject({
      id: "orphaned",
      name: "custom_tool",
      output: "still visible",
    });
  });

  it("normalizes direct bash execution into the same tool model", () => {
    const tool = projectedTools([
      {
        role: "bashExecution",
        command: "git status",
        output: "clean",
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: 10,
      },
    ])[0];

    expect(tool).toMatchObject({
      name: "bash",
      args: { command: "git status" },
      output: "clean",
      direct: true,
    });
    expect(formatAgentToolDetail(tool)).toBe("$ git status\n\nclean");
  });

  it("retains hidden-message boundaries and assistant errors correctly", () => {
    const projected = projectAgentTranscript([
      assistant([call("call", "bash", { command: "false" })], 1, {
        errorMessage: "Provider failed",
      }),
      result("call", "bash", ""),
      { role: "custom", display: false, content: "internal", timestamp: 2 },
    ]);

    expect(projected.map((item) => item.type)).toEqual([
      "activity",
      "assistant_error",
    ]);
    expect(projected[1]).toMatchObject({
      error: {
        summary: "Provider failed",
        details: null,
      },
    });
  });

  it("projects plans and rich Codex activity without flattening them", () => {
    const projected = projectAgentTranscript([
      assistant(
        [
          {
            type: "subagent",
            id: "collab-1",
            action: "spawnAgent",
            prompt: "Inspect tests",
            status: "completed",
            receivers: [
              {
                threadId: "child-1",
                status: "completed",
                message: null,
              },
            ],
            events: ["Tests are green."],
          },
          {
            type: "plan",
            id: "plan-1",
            text: "- [x] Inspect\n- [ ] Implement",
            explanation: "A focused plan.",
            steps: [
              { step: "Inspect", status: "completed" },
              { step: "Implement", status: "pending" },
            ],
          },
          { type: "text", text: "Plan ready." },
        ],
        1,
      ),
    ]);

    expect(projected.map((item) => item.type)).toEqual([
      "activity",
      "plan",
      "assistant_text",
    ]);
    expect(projected[0]).toMatchObject({
      entries: [
        {
          type: "subagent",
          activity: { events: ["Tests are green."] },
        },
      ],
    });
    expect(projected[1]).toMatchObject({
      type: "plan",
      explanation: "A focused plan.",
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "pending" },
      ],
    });
  });
});

describe("agent activity sequences", () => {
  it("positions adjacent activity without crossing conversational boundaries", () => {
    const projected = projectAgentTranscript([
      assistant([{ type: "thinking", thinking: "First thought" }], 1),
      assistant([call("read", "read", { path: "a.ts" })], 2),
      result("read", "read", "contents"),
      assistant([{ type: "text", text: "Visible update" }], 3),
      assistant([call("test", "bash", { command: "npm test" })], 4),
      result("test", "bash", "passed"),
    ]);

    expect(
      projected.map((item, index) =>
        agentActivitySequencePosition(projected, index),
      ),
    ).toEqual(["first", "last", null, "single"]);
  });
});

describe("agent error presentation", () => {
  it("summarizes context failures while retaining raw provider details", () => {
    const raw =
      "400 This model's maximum context length is 131072 tokens. However, you requested 32768 output tokens and your prompt contains 98305 input tokens.\n" +
      "raw-http-request=/home/user/.omp/logs/request.json";

    expect(presentAgentError(raw)).toEqual({
      summary:
        "Context limit exceeded. Compact the conversation or reduce the maximum output tokens.",
      details: raw,
    });
  });

  it("bounds unknown errors to their first line", () => {
    const firstLine = `Provider failure ${"x".repeat(300)}`;
    const error = presentAgentError(`${firstLine}\ninternal detail`);

    expect(error.summary).toHaveLength(240);
    expect(error.summary).toMatch(/\.\.\.$/u);
    expect(error.details).toBe(`${firstLine}\ninternal detail`);
  });
});

describe("agent activity presentation", () => {
  const tool = (
    id: string,
    name: string,
    args: unknown,
  ): AgentToolActivity => ({
    id,
    name,
    args,
    output: "",
    hasResult: true,
    partial: false,
    isError: false,
    direct: false,
    exitCode: null,
    cancelled: false,
    truncated: false,
    fullOutputPath: null,
    terminalInputs: [],
  });

  it("uses typed labels and compact aggregate summaries", () => {
    const shell = tool("shell", "bash", { command: "npm test" });
    const read = tool("read", "read_file", { path: "src/app.ts" });
    const edit = tool("edit", "apply_patch", { path: "src/app.ts" });

    expect(describeAgentTool(shell)).toEqual({
      category: "shell",
      label: "Terminal",
      summary: "npm test",
    });
    expect(
      describeAgentActivity(
        [
          { type: "tool", id: "shell", tool: shell },
          { type: "tool", id: "read", tool: read },
          { type: "tool", id: "edit", tool: edit },
        ],
        false,
      ),
    ).toEqual({
      label: "Edited 1 file, ran 1 command, and read 1 file",
      secondary: null,
      status: "completed",
    });
  });

  it("keeps a single running tool in the aggregate summary", () => {
    const shell = {
      ...tool("shell", "bash", { command: "npm test" }),
      hasResult: false,
    };
    expect(
      describeAgentActivity(
        [{ type: "tool", id: "shell", tool: shell }],
        true,
      ),
    ).toEqual({
      label: "Ran 1 command",
      secondary: null,
      status: "running",
    });
  });

  it("keeps a completed tool completed while the turn continues", () => {
    const shell = tool("shell", "bash", { command: "npm test" });

    expect(
      describeAgentActivity(
        [{ type: "tool", id: "shell", tool: shell }],
        true,
      ),
    ).toEqual({
      label: "Ran 1 command",
      secondary: null,
      status: "completed",
    });
  });

  it("keeps the aggregate summary stable while its latest tool runs", () => {
    const shell = tool("shell", "bash", { command: "npm test" });
    const search = {
      ...tool("search", "grep", {
        pattern: "runtimeStatus",
        path: "apps/web",
      }),
      hasResult: false,
    };

    expect(
      describeAgentActivity(
        [
          { type: "tool", id: "shell", tool: shell },
          { type: "tool", id: "search", tool: search },
        ],
        true,
      ),
    ).toEqual({
      label: "Ran 1 command and searched 1 time",
      secondary: null,
      status: "running",
    });
  });

  it("counts unique read and edited paths like the collapsed overview", () => {
    const firstRead = tool("read-1", "read", { path: "src/app.ts" });
    const secondRead = tool("read-2", "read", { path: "src/app.ts" });
    const edit = tool("edit", "apply_patch", { path: "src/app.ts" });
    const write = tool("write", "write", { path: "src/app.ts" });

    expect(
      describeAgentActivity(
        [firstRead, secondRead, edit, write].map((entry) => ({
          type: "tool" as const,
          id: entry.id,
          tool: entry,
        })),
        false,
      ),
    ).toEqual({
      label: "Edited 1 file and read 1 file",
      secondary: null,
      status: "completed",
    });
  });

  it("surfaces failed counts without splitting their tool results", () => {
    const first = tool("first", "bash", { command: "npm test" });
    const second = {
      ...tool("second", "bash", { command: "npm run lint" }),
      isError: true,
    };
    expect(
      describeAgentActivity(
        [
          { type: "tool", id: "first", tool: first },
          { type: "tool", id: "second", tool: second },
        ],
        false,
      ),
    ).toEqual({
      label: "Ran 2 commands, 1 failed",
      secondary: null,
      status: "failed",
    });
  });
});
