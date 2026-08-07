import { describe, expect, it } from "vitest";
import {
  agentToolStatus,
  describeAgentActivity,
  describeAgentTool,
  formatAgentToolDetail,
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
  it("pairs calls and results into one contiguous activity group", () => {
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
      "assistant_text",
    ]);
    const activity = projected[1];
    expect(activity).toMatchObject({
      type: "activity",
      entries: [
        { type: "thinking" },
        {
          type: "tool",
          tool: {
            id: "inspect",
            output: "0.11.2 abc\n0.11.4 def",
            hasResult: true,
          },
        },
        {
          type: "tool",
          tool: {
            id: "remove",
            output: "Deleted: sha256:abc",
            hasResult: true,
          },
        },
      ],
    });
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
      label: "Ran 1 command, read 1 file, and edited 1 file",
      secondary: null,
      status: "completed",
    });
  });

  it("shows the current command while a single tool is running", () => {
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
      label: "Running command",
      secondary: "npm test",
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
      label: "Ran command",
      secondary: "npm test",
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
