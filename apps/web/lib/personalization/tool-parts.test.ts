import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  describeMemoryToolPart,
  hasSuccessfulMemoryMutation,
  isMemoryToolPart,
  memoryToolArtifactLabel,
  memoryToolStatusLabel,
} from "@overtchat/shared";

type Part = UIMessage["parts"][number];

function part(value: Record<string, unknown>): Part {
  return value as unknown as Part;
}

describe("memory tool parts", () => {
  it("uses successful tool output as the authoritative display value", () => {
    const toolPart = part({
      type: "tool-set_memory",
      toolCallId: "memory",
      state: "output-available",
      input: { key: "style", value: "Unnormalized value" },
      output: { ok: true, key: "style", value: "Prefer concise answers." },
    });

    expect(isMemoryToolPart(toolPart)).toBe(true);
    if (!isMemoryToolPart(toolPart)) throw new Error("expected memory tool");
    expect(describeMemoryToolPart(toolPart)).toEqual({
      action: "set",
      status: "success",
      key: "style",
      value: "Prefer concise answers.",
    });
  });

  it("distinguishes a missing delete from an execution failure", () => {
    const toolPart = part({
      type: "tool-delete_memory",
      toolCallId: "memory",
      state: "output-available",
      input: { key: "missing" },
      output: { ok: false, key: "missing" },
    });

    if (!isMemoryToolPart(toolPart)) throw new Error("expected memory tool");
    expect(describeMemoryToolPart(toolPart)).toEqual({
      action: "delete",
      status: "missing",
      key: "missing",
    });
  });

  it.each([
    ["input-streaming", "running"],
    ["input-available", "running"],
    ["approval-requested", "running"],
    ["approval-responded", "running"],
    ["output-error", "error"],
    ["output-denied", "error"],
    ["unexpected-state", "incomplete"],
  ] as const)("maps %s to %s", (state, status) => {
    const toolPart = part({
      type: "tool-set_memory",
      toolCallId: state,
      state,
      input: { key: "style", value: "Concise" },
      errorText: state === "output-error" ? "Provider failed" : undefined,
    });

    if (!isMemoryToolPart(toolPart)) throw new Error("expected memory tool");
    expect(describeMemoryToolPart(toolPart).status).toBe(status);
  });

  it("only reports an actual successful mutation", () => {
    const message = {
      id: "assistant",
      role: "assistant",
      parts: [
        part({
          type: "tool-set_memory",
          toolCallId: "failed",
          state: "output-available",
          input: { key: "style", value: "Concise" },
          output: { ok: false, error: "Memory capacity reached" },
        }),
      ],
    } satisfies UIMessage;

    expect(hasSuccessfulMemoryMutation(message)).toBe(false);
  });

  it("detects a successful mutation among other message parts", () => {
    const message = {
      id: "assistant",
      role: "assistant",
      parts: [
        part({ type: "text", text: "I'll remember that." }),
        part({
          type: "tool-set_memory",
          toolCallId: "saved",
          state: "output-available",
          input: { key: "style", value: "Concise" },
          output: { ok: true, key: "style", value: "Concise" },
        }),
      ],
    } satisfies UIMessage;

    expect(hasSuccessfulMemoryMutation(message)).toBe(true);
  });

  it("provides consistent artifact labels for mixed outcomes", () => {
    const details = [
      { action: "set", status: "success", key: "style" },
      {
        action: "delete",
        status: "error",
        key: "missing",
        error: "Failed",
      },
    ] as const;

    expect(memoryToolArtifactLabel(details)).toBe(
      "Memories updated with errors",
    );
    expect(memoryToolStatusLabel(details[0])).toBe("Updated");
    expect(memoryToolStatusLabel(details[1])).toBe("Failed");
  });
});
