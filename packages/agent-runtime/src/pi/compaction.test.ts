import { describe, expect, it } from "vitest";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";
import { PiCompaction } from "./compaction";

function fixture() {
  let messages: unknown[] = [];
  const compaction = new PiCompaction((event) => {
    messages = applyAgentRuntimeMessageEvent(messages, event);
  });
  return { compaction, messages: () => messages };
}

describe("Pi/OMP compaction lifecycle", () => {
  it.each([
    [{ aborted: true }, "interrupted"],
    [{ errorMessage: "Provider unavailable" }, "failed"],
    [{ skipped: true }, "skipped"],
  ])("records unsuccessful automatic compaction %j", (detail, status) => {
    const { compaction, messages } = fixture();
    compaction.handle({ type: "auto_compaction_start", reason: "overflow" });
    compaction.handle({ type: "auto_compaction_end", ...detail as object });
    expect(messages()).toEqual([expect.objectContaining({ status, trigger: "auto" })]);
  });

  it("settles a failed manual RPC without claiming success", async () => {
    const { compaction, messages } = fixture();
    await expect(compaction.manual(async () => { throw new Error("No context"); })).rejects.toThrow("No context");
    expect(messages()).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("preserves manual result metadata when a provider also emits lifecycle events", async () => {
    const { compaction, messages } = fixture();
    await compaction.manual(async () => {
      compaction.handle({ type: "compaction_start", reason: "manual" });
      compaction.handle({ type: "compaction_end", reason: "manual" });
      return { tokensBefore: 1000 };
    });
    expect(messages()).toEqual([expect.objectContaining({ status: "completed", tokensBefore: 1000 })]);
  });

  it("settles cancellation and process exit without leaving a spinner", async () => {
    const { compaction, messages } = fixture();
    let reject!: (error: Error) => void;
    const pending = compaction.manual(() => new Promise((_, fail) => { reject = fail; }));
    const rejected = expect(pending).rejects.toThrow("Cancelled");
    await compaction.abort(async () => { reject(new Error("Cancelled")); });
    await rejected;
    compaction.handle({ type: "auto_compaction_start" });
    compaction.handle({ type: "process_exit" });
    expect(messages()).toHaveLength(2);
    expect(messages()).toEqual([
      expect.objectContaining({ status: "interrupted" }),
      expect.objectContaining({ status: "interrupted" }),
    ]);
  });
});
