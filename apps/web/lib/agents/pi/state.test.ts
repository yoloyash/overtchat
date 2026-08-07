import { describe, expect, it } from "vitest";
import type {
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "@/lib/agents/types";
import { applyAgentRuntimeEnvelope } from "./state";

function snapshot(): AgentRuntimeSnapshot {
  return {
    sessionId: "session",
    provider: "pi",
    status: "idle",
    activeTurn: null,
    state: { isStreaming: false },
    messages: [{ role: "user", content: "Hello" }],
    models: [],
    thinkingLevels: ["off"],
    commands: [],
    queuedMessages: [],
    stats: {
      sessionFile: null,
      sessionId: null,
      userMessages: 0,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 0,
      tokens: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
      cost: 0,
    },
  };
}

function event(
  data: Extract<AgentRuntimeEnvelope, { type: "pi_event" }>["data"],
): AgentRuntimeEnvelope {
  return { sequence: 1, type: "pi_event", data };
}

describe("agent runtime event reducer", () => {
  it("replaces the active assistant message as text streams", () => {
    const first = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      }),
    )!;
    const second = applyAgentRuntimeEnvelope(
      first,
      event({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello back" }],
        },
      }),
    )!;

    expect(second.messages).toEqual([
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello back" }],
      },
    ]);
  });

  it("replaces repeated user lifecycle events with the same timestamp", () => {
    const started = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "message_start",
        message: {
          role: "user",
          content: "Next prompt",
          timestamp: 123,
        },
      }),
    )!;
    const ended = applyAgentRuntimeEnvelope(
      started,
      event({
        type: "message_end",
        message: {
          role: "user",
          content: "Next prompt",
          timestamp: 123,
        },
      }),
    )!;

    expect(ended.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "user", content: "Next prompt", timestamp: 123 },
    ]);
  });

  it("keeps assistant messages on both sides of a tool result", () => {
    const firstAssistant = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call", name: "bash" }],
          timestamp: 10,
        },
      }),
    )!;
    const toolResult = applyAgentRuntimeEnvelope(
      firstAssistant,
      event({
        type: "tool_execution_end",
        toolCallId: "call",
        toolName: "bash",
        result: { content: [{ type: "text", text: "done" }] },
        isError: false,
      }),
    )!;
    const secondAssistant = applyAgentRuntimeEnvelope(
      toolResult,
      event({
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          timestamp: 20,
        },
      }),
    )!;

    expect(
      secondAssistant.messages.map((message) =>
        message && typeof message === "object"
          ? Reflect.get(message, "role")
          : null,
      ),
    ).toEqual(["user", "assistant", "toolResult", "assistant"]);
  });

  it("replaces partial tool output with the completed result", () => {
    const partial = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "tool_execution_update",
        toolCallId: "call",
        toolName: "bash",
        partialResult: {
          content: [{ type: "text", text: "partial" }],
        },
      }),
    )!;
    const complete = applyAgentRuntimeEnvelope(
      partial,
      event({
        type: "tool_execution_end",
        toolCallId: "call",
        toolName: "bash",
        result: { content: [{ type: "text", text: "complete" }] },
        isError: false,
      }),
    )!;

    expect(complete.messages).toHaveLength(2);
    expect(complete.messages[1]).toMatchObject({
      role: "toolResult",
      content: [{ type: "text", text: "complete" }],
      isError: false,
    });
  });

  it("renders OMP command output and waits for runtime-settled status", () => {
    const running = {
      ...snapshot(),
      provider: "omp" as const,
      status: "running" as const,
      state: { isStreaming: true },
    };
    const withOutput = applyAgentRuntimeEnvelope(
      running,
      event({ type: "command_output", text: "Current model: GPT-5.6" }),
    )!;
    const terminal = applyAgentRuntimeEnvelope(
      withOutput,
      event({ type: "agent_end", messages: [] }),
    )!;
    const settled = applyAgentRuntimeEnvelope(
      terminal,
      event({ type: "overtchat_status", status: "idle" }),
    )!;

    expect(withOutput.messages.at(-1)).toMatchObject({
      role: "custom",
      content: "Current model: GPT-5.6",
      display: true,
    });
    expect(terminal).toMatchObject({
      status: "running",
      state: { isStreaming: true },
    });
    expect(settled).toMatchObject({
      status: "idle",
      state: { isStreaming: false },
    });
  });

  it("keeps Pi running until the runtime confirms provider idle", () => {
    const running = {
      ...snapshot(),
      status: "running" as const,
      state: { isStreaming: true },
    };
    const ended = applyAgentRuntimeEnvelope(
      running,
      event({ type: "agent_end", messages: [] }),
    )!;
    const providerSettled = applyAgentRuntimeEnvelope(
      ended,
      event({ type: "agent_settled" }),
    )!;
    const settled = applyAgentRuntimeEnvelope(
      providerSettled,
      event({ type: "overtchat_status", status: "idle" }),
    )!;

    expect(ended).toMatchObject({
      status: "running",
      state: { isStreaming: true },
    });
    expect(providerSettled).toMatchObject({
      status: "running",
      state: { isStreaming: true },
    });
    expect(settled).toMatchObject({
      status: "idle",
      activeTurn: null,
      state: { isStreaming: false },
    });
  });

  it("tracks active-turn timing and compaction independently", () => {
    const started = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_status",
        status: "running",
        startedAt: 123,
      }),
    )!;
    const compacting = applyAgentRuntimeEnvelope(
      started,
      event({ type: "compaction_start", reason: "auto" }),
    )!;
    const exited = applyAgentRuntimeEnvelope(
      compacting,
      event({ type: "process_exit", error: "Provider stopped" }),
    )!;
    const compacted = applyAgentRuntimeEnvelope(
      compacting,
      event({ type: "compaction_end", reason: "auto" }),
    )!;
    const settled = applyAgentRuntimeEnvelope(
      compacted,
      event({ type: "overtchat_status", status: "idle" }),
    )!;

    expect(started.activeTurn?.startedAt).toBe(123);
    expect(compacting).toMatchObject({
      status: "running",
      state: { isCompacting: true },
    });
    expect(exited).toMatchObject({
      status: "exited",
      activeTurn: null,
      state: { isStreaming: false, isCompacting: false },
    });
    expect(compacted).toMatchObject({
      status: "running",
      state: { isCompacting: false },
    });
    expect(settled.activeTurn).toBeNull();
  });

  it("tracks native provider queues and late prompt errors", () => {
    const queued = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "queue_update",
        steering: ["Check the database path"],
        followUp: ["Then summarize"],
      }),
    )!;
    const failed = applyAgentRuntimeEnvelope(
      queued,
      event({
        type: "rpc_error",
        command: "prompt",
        error: "Queue rejected",
      }),
    )!;

    expect(queued.queuedMessages).toEqual([
      {
        id: "steer:0",
        message: "Check the database path",
        delivery: "steer",
      },
      {
        id: "follow_up:0",
        message: "Then summarize",
        delivery: "follow_up",
      },
    ]);
    expect(queued.messages).toEqual(snapshot().messages);
    expect(failed.error).toBe("Queue rejected");
    expect(failed.queuedMessages).toEqual(queued.queuedMessages);
  });

  it("ignores malformed native provider queue updates", () => {
    const current = snapshot();
    expect(
      applyAgentRuntimeEnvelope(
        current,
        event({
          type: "queue_update",
          steering: "Check the database path",
          followUp: ["Then summarize"],
        }),
      ),
    ).toBe(current);
  });

  it("uses authoritative snapshots after live deltas", () => {
    const authoritative = snapshot();
    authoritative.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
    });

    expect(
      applyAgentRuntimeEnvelope(snapshot(), {
        sequence: 8,
        type: "snapshot",
        data: authoritative,
      }),
    ).toBe(authoritative);
  });
});
