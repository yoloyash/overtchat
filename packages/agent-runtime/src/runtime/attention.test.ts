import { describe, expect, it } from "vitest";
import {
  AgentTurnTracker,
  assistantMessageError,
  lastAssistantPreview,
  previewText,
  sessionAttention,
  shellCommand,
  statusText,
} from "./attention";

describe("status text", () => {
  it("collapses whitespace and clips at the wire limit", () => {
    expect(statusText("  one\n\n two\tthree ")).toBe("one two three");
    const clipped = statusText("word ".repeat(100));
    expect(clipped).toHaveLength(280);
    expect(clipped.endsWith("…")).toBe(true);
  });

  it.each([
    ["## Summary\n\nFixed **the** flaky test.", "Summary Fixed the flaky test."],
    ["- one\n- two\n1. three", "one two three"],
    ["See [the docs](https://example.com) and `npm ci`.", "See the docs and npm ci."],
    ["```ts\nconst a = 1;\n```\nDone.", "const a = 1; Done."],
    ["> quoted _note_", "quoted note"],
    ["snake_case_name stays", "snake_case_name stays"],
  ])("previews %j as plain text", (markdown, preview) => {
    expect(previewText(markdown)).toBe(preview);
  });

  it("previews the newest assistant message with visible text", () => {
    expect(
      lastAssistantPreview([
        { role: "assistant", content: "Older reply" },
        { role: "assistant", content: [{ type: "text", text: "Newest reply" }] },
        { role: "assistant", content: [{ type: "toolCall", name: "bash" }] },
        { role: "toolResult", content: "output" },
      ]),
    ).toBe("Newest reply");
    expect(lastAssistantPreview([{ role: "user", content: "Hi" }])).toBeUndefined();
  });
});

describe("session attention", () => {
  const request = { type: "interaction_request" as const, id: "request" };

  // Titles match the approval card the notification opens.
  it("summarizes a shell approval with its command", () => {
    expect(
      sessionAttention(
        {
          ...request,
          method: "select",
          title: "Allow Bash?",
          message: "Claude needs permission to continue.",
          approvalKind: "tool",
          toolName: "Bash",
          toolDetail: { type: "shell", command: "npm ci\n  --prefer-offline" },
        },
        10,
      ),
    ).toEqual({
      kind: "approval",
      id: "request",
      requestedAt: 10,
      title: "Allow Bash",
      detail: "npm ci --prefer-offline",
    });
  });

  it.each([
    [`/bin/zsh -lc "touch '/home/a b/probe'"`, "touch '/home/a b/probe'"],
    [`bash -c 'npm test'`, "npm test"],
    [`/bin/bash -lc "echo \\"hi\\" \\$HOME"`, `echo "hi" $HOME`],
    ["npm ci", "npm ci"],
    [`zsh -lc "unbalanced'`, `zsh -lc "unbalanced'`],
  ])("shows the command inside a shell wrapper: %s", (command, shown) => {
    expect(shellCommand(command)).toBe(shown);
  });

  it("names the file of an edit approval", () => {
    expect(
      sessionAttention(
        {
          ...request,
          method: "select",
          title: "Allow Edit?",
          approvalKind: "tool",
          toolDetail: { type: "edit", filePath: "/repo/src/app.ts" },
        },
        10,
      ),
    ).toMatchObject({ title: "Allow Edit", detail: "/repo/src/app.ts" });
  });

  it("counts the files of a multi-file edit approval", () => {
    expect(
      sessionAttention(
        {
          ...request,
          method: "select",
          title: "Approve file changes",
          approvalKind: "tool",
          toolDetail: {
            type: "edit",
            changes: [
              { filePath: "/repo/a.ts", patch: "+a" },
              { filePath: "/repo/b.ts", patch: "+b" },
              { filePath: "/repo/c.ts", patch: "+c" },
            ],
          },
        },
        10,
      ),
    ).toMatchObject({ detail: "/repo/a.ts and 2 more" });
  });

  it("keeps a tool approval's description when there is no command or path", () => {
    expect(
      sessionAttention(
        {
          ...request,
          method: "select",
          title: "Allow WebFetch?",
          message: "Fetch https://example.com",
          approvalKind: "tool",
          toolDetail: { type: "json", value: { url: "https://example.com" } },
        },
        10,
      ),
    ).toMatchObject({ title: "Allow WebFetch", detail: "Fetch https://example.com" });
  });

  it("summarizes a question with its prompt", () => {
    expect(
      sessionAttention(
        {
          ...request,
          method: "form",
          title: "Route",
          message: "Keep the old /api/v1 route during the migration?",
          fields: [],
        },
        10,
      ),
    ).toEqual({
      kind: "question",
      id: "request",
      requestedAt: 10,
      title: "Route",
      detail: "Keep the old /api/v1 route during the migration?",
    });
    expect(sessionAttention({ ...request, method: "input" }, 10)).toEqual({
      kind: "question",
      id: "request",
      requestedAt: 10,
      title: "Needs your input",
    });
  });
});

describe("turn tracker", () => {
  const messages = () => [{ role: "assistant", content: "All **done**." }];
  const running = (error?: string) => ({ status: "running" as const, startedAt: 100, error });

  it("records a completed turn with a preview", () => {
    const tracker = new AgentTurnTracker("idle", null);
    expect(tracker.observe(running(), messages, 100)).toBe(false);
    expect(tracker.observe(running(), messages, 150)).toBe(false);
    expect(
      tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 200),
    ).toBe(true);
    expect(tracker.lastTurn).toEqual({
      outcome: "completed",
      startedAt: 100,
      endedAt: 200,
      preview: "All done.",
    });
    // Later idle observations do not end another turn.
    expect(
      tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 300),
    ).toBe(false);
  });

  it("keeps the turn's own error after the runtime clears it", () => {
    const tracker = new AgentTurnTracker("idle", null);
    tracker.observe(running(), messages, 100);
    tracker.observeError("Rate limit reached");
    tracker.observe(running(), messages, 160);
    tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 200);
    expect(tracker.lastTurn).toMatchObject({ outcome: "failed", error: "Rate limit reached" });
  });

  it("lets another command fail mid-turn without failing the turn", () => {
    const tracker = new AgentTurnTracker("idle", null);
    tracker.observe(running(), messages, 100);
    // A refused steer or compaction shows as a runtime error while the turn goes on.
    tracker.observe(running("Steer rejected"), messages, 150);
    tracker.observe(running(), messages, 160);
    tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 200);
    expect(tracker.lastTurn).toMatchObject({ outcome: "completed" });
    expect(tracker.lastTurn?.error).toBeUndefined();
  });

  it("fails a turn the provider marked failed or that exits", () => {
    const failed = new AgentTurnTracker("running", 50);
    failed.markFailed();
    failed.observe({ status: "idle", startedAt: null, error: undefined }, () => [], 200);
    expect(failed.lastTurn).toEqual({ outcome: "failed", startedAt: 50, endedAt: 200 });

    const exited = new AgentTurnTracker("running", 50);
    exited.observe({ status: "exited", startedAt: null, error: "Codex exited." }, () => [], 200);
    expect(exited.lastTurn).toMatchObject({ outcome: "failed", error: "Codex exited." });
  });

  it("fails a turn only when its final reply ended with an error", () => {
    const failedReply = {
      role: "assistant",
      stopReason: "error",
      errorMessage: "429 Too Many Requests",
    };
    const failed = new AgentTurnTracker("running", 50);
    failed.observeReply(failedReply);
    failed.observe({ status: "idle", startedAt: null, error: undefined }, () => [], 200);
    expect(failed.lastTurn).toMatchObject({ outcome: "failed", error: "429 Too Many Requests" });

    // A provider that falls back to another model recovers within the turn.
    const recovered = new AgentTurnTracker("running", 50);
    recovered.observeReply(failedReply);
    recovered.observeReply({ role: "assistant", stopReason: "stop", content: "Done." });
    recovered.observe({ status: "idle", startedAt: null, error: undefined }, () => [], 200);
    expect(recovered.lastTurn?.outcome).toBe("completed");

    expect(assistantMessageError({ role: "assistant", stopReason: "error" })).toBe(
      "The model request failed.",
    );
    expect(assistantMessageError({ role: "assistant", stopReason: "stop" })).toBeUndefined();
    expect(assistantMessageError({ role: "user", stopReason: "error" })).toBeUndefined();
  });

  it("records a user stop without the abort error", () => {
    const tracker = new AgentTurnTracker("running", 50);
    tracker.requestStop();
    tracker.observe({ status: "idle", startedAt: null, error: "Interrupted" }, messages, 200);
    expect(tracker.lastTurn).toEqual({
      outcome: "stopped",
      startedAt: 50,
      endedAt: 200,
      preview: "All done.",
    });
  });

  it("does not carry a cancelled stop into the turn result", () => {
    const tracker = new AgentTurnTracker("running", 50);
    tracker.requestStop();
    tracker.cancelStop();
    tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 200);
    expect(tracker.lastTurn?.outcome).toBe("completed");
  });

  it("ignores stop requests and failures outside a turn", () => {
    const tracker = new AgentTurnTracker("idle", null);
    tracker.requestStop();
    tracker.markFailed();
    tracker.observe(running(), messages, 100);
    tracker.observe({ status: "idle", startedAt: null, error: undefined }, messages, 200);
    expect(tracker.lastTurn?.outcome).toBe("completed");
  });

  it("does not report an idle runtime shutting down as a turn", () => {
    const tracker = new AgentTurnTracker("idle", null);
    expect(
      tracker.observe({ status: "exited", startedAt: null, error: "Stopped" }, messages, 200),
    ).toBe(false);
    expect(tracker.lastTurn).toBeUndefined();
  });
});
