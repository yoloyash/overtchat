import { describe, expect, it } from "vitest";
import { agentWorkLabel, foldAgentTranscript, projectAgentTranscript } from "./presentation";

const user = (id: string) => ({ role: "user", id, content: id });
const text = (id: string, body = id, extra = {}) => ({
  role: "assistant", id, content: [{ type: "text", text: body }], ...extra,
});
const tool = (id: string, extra = {}) => ({
  role: "assistant", id, content: [{ type: "toolCall", id, name: "bash", arguments: { command: "ls" } }], ...extra,
});
const result = (id: string, extra = {}) => ({ role: "toolResult", toolCallId: id, content: "ok", ...extra });
const turn = [user("request"), text("progress"), tool("cmd"), result("cmd"), text("answer")];
const fold = (messages: unknown[], unsettled = false, expanded = new Set<string>()) =>
  foldAgentTranscript(projectAgentTranscript(messages), { unsettled, expanded });
const texts = (items: ReturnType<typeof fold>) => items.flatMap((item) => item.type === "assistant_text" ? [item.text] : []);

describe("completed agent work", () => {
  it("derives duration from numeric or ISO timestamps and prefers recorded duration", () => {
    const messages = [
      { ...user("u"), timestamp: "2026-09-30T10:00:00.000Z" },
      { ...text("progress"), timestamp: Date.parse("2026-09-30T10:00:03.000Z") },
      { ...text("answer"), timestamp: "2026-09-30T10:01:05.000Z" },
    ];
    const summary = fold(messages).find((item) => item.type === "work_summary");
    expect(summary).toMatchObject({ durationMs: 65000 });
    expect(agentWorkLabel(summary!.durationMs)).toBe("Worked for 1m 5s");
    expect(fold(messages.map((message) => message.id === "answer"
      ? { ...message, updatedAt: "2026-09-30T10:01:10.000Z" } : message))
      .find((item) => item.type === "work_summary")).toMatchObject({ durationMs: 70000 });
    expect(fold([...messages, { role: "turnFooter", durationMs: 70000 }])
      .find((item) => item.type === "work_summary")).toMatchObject({ durationMs: 70000 });
    expect(agentWorkLabel(null)).toBe("Worked");
    expect(agentWorkLabel(3600000)).toBe("Worked for 1h");
    expect(fold(messages.map((message) => ({ ...message, timestamp: "invalid" })))
      .find((item) => item.type === "work_summary")).toMatchObject({ durationMs: null });
  });

  it("retains closing rows with stable keys only when requested by an animated client", () => {
    const projected = projectAgentTranscript(turn);
    const rows = foldAgentTranscript(projected, { unsettled: false, expanded: new Set(), retainFolded: true });
    expect(rows.filter((item) => item.folded).map((item) => item.type)).toEqual(["assistant_text", "activity"]);
    expect(rows.filter((item) => !item.folded)).toEqual(fold(turn));
    expect(rows.filter((item) => item.type !== "work_summary").map((item) => item.key)).toEqual(projected.map((item) => item.key));
  });
  it("keeps live work visible, folds on completion, and expands without changing the transcript", () => {
    const projected = projectAgentTranscript(turn);
    const original = structuredClone(projected);
    expect(fold(turn, true)).toEqual(projected);
    const completed = fold(turn);
    expect(completed.map((item) => item.type)).toEqual(["message", "work_summary", "assistant_text"]);
    expect(texts(completed)).toEqual(["answer"]);
    const summary = completed.find((item) => item.type === "work_summary")!;
    const expanded = foldAgentTranscript(projected, { unsettled: false, expanded: new Set([summary.key]) });
    expect(expanded.filter((item) => item.type !== "work_summary")).toEqual(projected);
    expect(projected).toEqual(original);
  });

  it("preserves every text block of a final response", () => {
    const messages = [...turn.slice(0, -1), {
      role: "assistant", id: "answer", content: [
        { type: "text", text: "Summary" },
        { type: "thinking", thinking: "Check" },
        { type: "text", text: "Details" },
      ],
    }];
    expect(texts(fold(messages))).toEqual(["Summary", "Details"]);
  });

  it("separates Codex items sharing a fork boundary and uses explicit final phases", () => {
    const codex = (id: string, phase: string) => text(id, id, {
      overtchatTurnId: "native", overtchatTurnBoundaryId: "boundary",
      content: [{ type: "text", text: id, phase }],
    });
    const messages = [user("u"), codex("progress", "commentary"), codex("summary", "final_answer"), codex("details", "final_answer"), {
      role: "turnFooter", overtchatTurnId: "native", messageId: "boundary", content: "full response", durationMs: 65000,
    }];
    const rows = fold(messages);
    expect(texts(rows)).toEqual(["summary", "details"]);
    expect(rows.find((item) => item.type === "work_summary")).toMatchObject({ durationMs: 65000 });
    expect(rows.at(-1)).toMatchObject({ type: "turn_footer", durationMs: null, text: "full response", messageId: "boundary" });
    expect(fold(messages.slice(0, 2)).some((item) => item.type === "work_summary")).toBe(false);
  });

  it("falls back to separate Codex item identities when phases are absent", () => {
    const messages = ["progress", "answer"].map((id) => text(id, id, { overtchatTurnBoundaryId: "boundary" }));
    expect(texts(fold(messages))).toEqual(["answer"]);
  });

  it("folds text before tools even when the provider uses one assistant message", () => {
    const messages = [user("u"), {
      role: "assistant", id: "response", content: [
        { type: "text", text: "Checking" },
        { type: "toolCall", id: "cmd", name: "bash", arguments: {} },
        { type: "text", text: "Summary" },
        { type: "text", text: "Details" },
      ],
    }, result("cmd")];
    expect(texts(fold(messages))).toEqual(["Summary", "Details"]);
  });

  it("preserves subagent cards and unfinished tool activity", () => {
    const messages = [...turn.slice(0, -1), tool("pending"), {
      role: "assistant", id: "agent", content: [{ type: "subagent", id: "child", action: "Review", status: "running" }],
    }, text("answer")];
    const rows = fold(messages);
    const entries = rows.flatMap((item) => item.type === "activity" ? item.entries : []);
    expect(entries.some((entry) => entry.type === "subagent")).toBe(true);
    expect(entries.some((entry) => entry.type === "tool" && entry.tool.id === "pending")).toBe(true);
  });

  it("keeps simple answers, missing answers, interruptions, and errors unfolded", () => {
    for (const messages of [
      [user("u"), text("answer")],
      turn.slice(0, -1),
      [...turn, text("stopped", "Stopped", { stopReason: "aborted" })],
      [...turn, text("failed", "", { errorMessage: "Failure" })],
    ]) expect(fold(messages).some((item) => item.type === "work_summary")).toBe(false);
  });

  it("folds failed tools with successful tools while keeping actionable plans visible", () => {
    const messages = [...turn.slice(0, -1), tool("failed"), result("failed", { isError: true }), {
      role: "assistant", id: "plan", content: [{ type: "plan", text: "Plan", actionable: true }],
    }, text("answer")];
    const rows = fold(messages);
    expect(rows.some((item) => item.type === "work_summary")).toBe(true);
    expect(rows.some((item) => item.type === "activity")).toBe(false);
    expect(rows.some((item) => item.type === "plan")).toBe(true);
    const summary = rows.find((item) => item.type === "work_summary")!;
    const expanded = fold(messages, false, new Set([summary.key]));
    expect(expanded.filter((item) => item.type !== "work_summary"))
      .toEqual(projectAgentTranscript(messages));
  });

  it("keeps earlier turns folded while a later turn runs", () => {
    const rows = fold([...turn, user("next"), text("working")], true);
    expect(texts(rows)).toEqual(["answer", "working"]);
    expect(rows.filter((item) => item.type === "work_summary")).toHaveLength(1);
  });

  it("respects native turn boundaries without an intervening user message", () => {
    const messages = [
      text("p1", "progress one", { overtchatTurnId: "one" }),
      text("a1", "answer one", { overtchatTurnId: "one" }),
      text("p2", "progress two", { overtchatTurnId: "two" }),
      text("a2", "answer two", { overtchatTurnId: "two" }),
    ];
    expect(texts(fold(messages))).toEqual(["answer one", "answer two"]);
    expect(fold(messages).filter((item) => item.type === "work_summary")).toHaveLength(2);
  });

  it("keeps work before steering visible until the native turn finishes", () => {
    const messages = [user("u"), text("progress"), text("checking"), user("steer"), text("continuing")]
      .map((message) => ({ ...message, overtchatTurnId: "native" }));
    expect(fold(messages, true)).toEqual(projectAgentTranscript(messages));
    expect(fold([...messages, { role: "turnFooter", overtchatTurnId: "native" }], true)
      .some((item) => item.type === "work_summary")).toBe(true);
  });

  it("preserves interruption metadata when adjacent tools are grouped", () => {
    const messages = [user("u"), text("progress"), tool("one"), result("one"),
      tool("two", { stopReason: "interrupted" }), result("two"), text("answer")];
    expect(fold(messages).some((item) => item.type === "work_summary")).toBe(false);
  });
});
