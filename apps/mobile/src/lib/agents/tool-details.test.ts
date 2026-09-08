import { describe, expect, it } from "vitest";
import type { AgentToolActivity } from "@overtchat/shared/agent-presentation";
import { approvalDetails, toolDetails } from "./tool-details";
const tool = (overrides: Partial<AgentToolActivity>): AgentToolActivity => ({
  id: "tool",
  name: "bash",
  args: {},
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
  ...overrides,
});

describe("tool detail presentation", () => {
  it("preserves commands, directory, error output and terminal metadata", () => {
    const result = toolDetails(
      tool({
        args: { command: "npm test\nprintf done", cwd: "/repo", timeout: 100 },
        output: "\x1b[31mFAIL\x1b[0m\r\nExpected 2",
        exitCode: 1,
        isError: true,
        truncated: true,
        fullOutputPath: "/tmp/full.txt",
        terminalInputs: ["yes"],
      }),
    );
    expect(result.sections).toEqual(
      expect.arrayContaining([
        { label: "Command", value: "npm test\nprintf done", kind: "code" },
        { label: "Working directory", value: "/repo", kind: "code" },
        { label: "Timeout", value: "100", kind: "code" },
        { label: "Error output", value: "FAIL\nExpected 2", kind: "code" },
        { label: "Exit code", value: "1", kind: "text" },
        { label: "Terminal input", value: "yes", kind: "code" },
      ]),
    );
    expect(result.sections.at(-1)?.value).toContain("/tmp/full.txt");
  });
  it("preserves a patch and old/new replacements without inventing unavailable changes", () => {
    expect(
      toolDetails(
        tool({ name: "apply_patch", args: { patch: "@@\n-old\n+new" } }),
      ).sections[0],
    ).toEqual({ label: "Changes", value: "@@\n-old\n+new", kind: "diff" });
    expect(
      toolDetails(
        tool({
          name: "Edit",
          args: { file_path: "a.ts", old_string: "", new_string: "new" },
        }),
      ).sections,
    ).toEqual([
      { label: "Path", value: "a.ts", kind: "code" },
      { label: "Before", value: "", kind: "code" },
      { label: "After", value: "new", kind: "code" },
    ]);
    expect(
      approvalDetails({
        approvalKind: "tool",
        toolDetail: { type: "edit", filePath: "a.ts" },
      }).sections,
    ).toEqual([{ label: "Path", value: "a.ts", kind: "code" }]);
  });
  it("turns unknown nested inputs into labelled values without losing values", () => {
    const result = approvalDetails({
      approvalKind: "tool",
      toolDetail: {
        type: "json",
        value: {
          target: { url: "https://example.com", enabled: false },
          items: ["a", "b"],
          retries: 0,
        },
      },
    });
    expect(
      result.sections.map((section) => [section.label, section.value]),
    ).toEqual([
      ["Target · Url", "https://example.com"],
      ["Target · Enabled", "false"],
      ["Items · Item 1", "a"],
      ["Items · Item 2", "b"],
      ["Retries", "0"],
    ]);
  });
  it("preserves provider approval values and avoids repeating OMP's command", () => {
    const result = approvalDetails({
      approvalKind: "tool",
      message: "Command: npm test",
      toolDetail: { type: "shell", command: "npm test" },
      approveValue: "Approve",
      alwaysValue: "Allow always",
      denyValue: "Deny",
    });
    expect(result.message).toBe("");
    expect(result.choices.map((choice) => choice.value)).toEqual([
      "Approve",
      "Allow always",
      "Deny",
    ]);
  });
  it("recognizes Codex permission requests without treating arbitrary questions as approvals", () => {
    const request = {
      id: "codex:12",
      method: "select",
      title: "Approve command?",
      message: "Needs network access\n\n$ npm install\necho finished",
      options: ["Allow once", "Allow for session", "Deny"],
    };
    const result = approvalDetails(request);
    expect(result.message).toBe("Needs network access");
    expect(result.sections).toEqual([
      { label: "Command", value: "npm install\necho finished", kind: "code" },
    ]);
    expect(result.choices[1].value).toBe("Allow for session");
    expect(
      approvalDetails({ ...request, title: "Which approach?" }).choices,
    ).toEqual([]);
  });
});

it("renders Codex network and filesystem permissions as labelled values", () => {
  const result = approvalDetails({
    id: "codex:permission",
    title: "Approve additional permissions?",
    options: ["Allow once", "Allow for session", "Deny"],
    message:
      'Needs access\n\nNetwork: {"enabled":true}\n\nFiles: {"write":["/repo"]}',
  });
  expect(result.message).toBe("Needs access");
  expect(result.sections.map((section) => section.value)).toEqual([
    "true",
    "/repo",
  ]);
});
