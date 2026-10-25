import { describe, expect, it } from "vitest";
import { AGENT_TERMINAL_MAX_INPUT_CHARS } from "./agents";
import { isTerminalControl, isTerminalHostMessage, isTerminalViewMessage } from "./terminal";

describe("terminal wire validation", () => {
  it("bounds paste size and terminal dimensions", () => {
    expect(isTerminalControl({ type: "input", data: "😀\u001b[A" })).toBe(true);
    expect(isTerminalControl({ type: "input", data: "x".repeat(AGENT_TERMINAL_MAX_INPUT_CHARS + 1) })).toBe(false);
    for (const size of [null, { cols: 0, rows: 24 }, { cols: 80, rows: 1.5 }, { cols: Infinity, rows: 24 }]) {
      expect(isTerminalControl({ type: "resize", size })).toBe(false);
    }
    expect(isTerminalControl({ type: "resize", size: { cols: 80, rows: 24 }, claim: "yes" })).toBe(false);
  });
  it("requires a validated workspace for host attachments", () => {
    expect(isTerminalHostMessage({ type: "attach", streamId: "stream", workspace: {}, size: { cols: 80, rows: 24 } })).toBe(false);
    expect(isTerminalHostMessage({ type: "control", streamId: "", control: { type: "kill" } })).toBe(false);
    expect(isTerminalHostMessage({ type: "control", streamId: "stream", control: { type: "kill" } })).toBe(true);
  });
  it("rejects corrupt baselines and nonmonotonic revision representations", () => {
    const snapshot = { workspaceId: "workspace", revision: 0, data: "", cols: 80, rows: 24, exited: false, exitCode: null, signal: null };
    expect(isTerminalViewMessage({ type: "snapshot", snapshot })).toBe(true);
    expect(isTerminalViewMessage({ type: "snapshot", snapshot: { ...snapshot, workspaceId: undefined } })).toBe(false);
    for (const revision of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(isTerminalViewMessage({ type: "output", revision, data: "output" })).toBe(false);
    }
  });
});
