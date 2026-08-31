import { describe, expect, it } from "vitest";
import type {
  AgentRuntimeEnvelope,
  AgentRuntimeSnapshot,
} from "./agents.js";
import {
  applyAgentRuntimeEnvelope,
  reconcileAgentRuntimeSnapshot,
} from "./state.js";

function snapshot(): AgentRuntimeSnapshot {
  return {
    sessionId: "session",
    provider: "pi",
    capabilities: { steer: true },
    status: "idle",
    activeTurn: null,
    state: { isStreaming: false },
    messages: [{ role: "user", content: "Hello" }],
    models: [],
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
  data: Extract<AgentRuntimeEnvelope, { type: "runtime_event" }>["data"],
): AgentRuntimeEnvelope {
  return { epoch: "runtime", sequence: 1, type: "runtime_event", data };
}

describe("agent runtime event reducer", () => {
  it("uses a connector-recorded timestamp for replay-derived state", () => {
    const started = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "agent_start",
        overtchatRecordedAt: 1_234,
      }),
    )!;
    const output = applyAgentRuntimeEnvelope(
      started,
      event({
        type: "command_output",
        text: "Current model: GPT-5.6",
        overtchatRecordedAt: 2_345,
      }),
    )!;
    const tool = applyAgentRuntimeEnvelope(
      output,
      event({
        type: "tool_execution_update",
        toolCallId: "call",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text: "partial" }] },
        overtchatRecordedAt: 3_456,
      }),
    )!;

    expect(tool.activeTurn).toEqual({ startedAt: 1_234 });
    expect(tool.messages.at(-2)).toMatchObject({ timestamp: 2_345 });
    expect(tool.messages.at(-1)).toMatchObject({ timestamp: 3_456 });
  });

  it("reconciles resumed provider history without dropping connector-only messages", () => {
    const durable = {
      ...snapshot(),
      status: "exited" as const,
      error: "Connector stopped",
      messages: [
        {
          role: "user",
          content: "queued prompt",
          overtchatSubmissionId: "submission-1",
        },
        {
          role: "assistant",
          content: "old partial",
          overtchatTurnId: "turn-1",
        },
        { role: "custom", content: "connector command output" },
      ],
    };
    const fresh = {
      ...snapshot(),
      status: "running" as const,
      activeTurn: { startedAt: 42 },
      state: { isStreaming: true },
      messages: [
        {
          id: "provider-user",
          role: "user",
          content: "queued prompt",
          overtchatSubmissionId: "submission-1",
          overtchatTurnId: "turn-1",
        },
        {
          id: "provider-assistant",
          role: "assistant",
          content: "complete",
          overtchatTurnId: "turn-1",
        },
      ],
    };

    const reconciled = reconcileAgentRuntimeSnapshot(durable, fresh);

    expect(reconciled).toMatchObject({
      status: "running",
      activeTurn: { startedAt: 42 },
      state: { isStreaming: true },
      messages: [
        expect.objectContaining({ id: "provider-user" }),
        expect.objectContaining({ id: "provider-assistant" }),
        { role: "custom", content: "connector command output" },
      ],
    });
    expect(reconciled).not.toHaveProperty("error");
  });

  it("treats plain resumed provider history as authoritative", () => {
    const providerMessages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hello back" },
    ];
    const durable = { ...snapshot(), messages: [...providerMessages] };
    const fresh = { ...snapshot(), messages: [...providerMessages] };

    const once = reconcileAgentRuntimeSnapshot(durable, fresh);
    const twice = reconcileAgentRuntimeSnapshot(once, fresh);

    expect(once.messages).toEqual(providerMessages);
    expect(twice.messages).toEqual(providerMessages);
  });

  it("preserves submitted image presentation when provider history takes over", () => {
    const submittedContent = [
      { type: "text", text: "Run tests" },
      {
        type: "image",
        url: "/api/uploads/image-1",
        mimeType: "image/png",
        filename: "screen.png",
      },
    ];
    const durable = {
      ...snapshot(),
      messages: [
        {
          role: "user",
          content: submittedContent,
          timestamp: 100,
          overtchatProviderTimestamp: 200,
          overtchatSubmissionId: "submission-1",
        },
      ],
    };
    const providerMessage = {
      id: "provider-message",
      role: "user",
      content: [
        { type: "text", text: "Run tests" },
        { data: "aW1hZ2U=", mimeType: "image/png" },
      ],
      timestamp: 200,
    };
    const reconciled = reconcileAgentRuntimeSnapshot(durable, {
      ...snapshot(),
      messages: [providerMessage],
      queuedMessages: [
        {
          id: "submission-1",
          message: "Run tests",
          status: "uncertain",
        },
      ],
    });

    expect(reconciled.messages).toEqual([
      {
        id: "provider-message",
        role: "user",
        content: submittedContent,
        timestamp: 100,
        overtchatProviderTimestamp: 200,
        overtchatSubmissionId: "submission-1",
      },
    ]);
    expect(reconciled.queuedMessages).toEqual([
      {
        id: "submission-1",
        message: "Run tests",
        status: "uncertain",
      },
    ]);
  });

  it("does not infer submission identity from repeated prompt text", () => {
    const submittedContent = [
      { type: "text", text: "Inspect this" },
      {
        type: "image",
        url: "/api/uploads/image-1",
        mimeType: "image/png",
        filename: "screen.png",
      },
    ];
    const reconciled = reconcileAgentRuntimeSnapshot(
      {
        ...snapshot(),
        messages: [
          { role: "user", content: "Inspect this" },
          { role: "assistant", content: "First response" },
          {
            role: "user",
            content: submittedContent,
            timestamp: 100,
            overtchatSubmissionId: "submission-1",
          },
        ],
      },
      {
        ...snapshot(),
        messages: [
          { id: "provider-user-1", role: "user", content: "Inspect this" },
          { id: "provider-assistant", role: "assistant", content: "First response" },
          {
            id: "provider-user-2",
            role: "user",
            content: [
              { type: "text", text: "Inspect this" },
              { data: "aW1hZ2U=", mimeType: "image/png" },
            ],
            timestamp: 200,
          },
        ],
      },
    );

    expect(reconciled.messages).toEqual([
      { id: "provider-user-1", role: "user", content: "Inspect this" },
      { id: "provider-assistant", role: "assistant", content: "First response" },
      {
        id: "provider-user-2",
        role: "user",
        content: [
          { type: "text", text: "Inspect this" },
          { data: "aW1hZ2U=", mimeType: "image/png" },
        ],
        timestamp: 200,
      },
    ]);
  });

  it("uses tool-call identity when fresh history completes durable output", () => {
    const durable = {
      ...snapshot(),
      messages: [
        {
          role: "toolResult",
          toolCallId: "call-1",
          content: "partial",
          timestamp: 100,
          overtchatPartial: true,
        },
      ],
    };
    const completed = {
      role: "toolResult",
      toolCallId: "call-1",
      content: "complete",
      timestamp: 200,
      overtchatPartial: false,
    };

    const reconciled = reconcileAgentRuntimeSnapshot(durable, {
      ...snapshot(),
      messages: [completed],
    });

    expect(reconciled.messages).toEqual([completed]);
  });

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

  it("atomically restores canonical turn order after optimistic steer races", () => {
    const initial = { ...snapshot(), messages: [] };
    const prompt = applyAgentRuntimeEnvelope(
      initial,
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "write a paragraph on overtchat",
          overtchatSubmissionId: "prompt",
        },
      }),
    )!;
    const steered = applyAgentRuntimeEnvelope(
      prompt,
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "2 more now",
          overtchatSubmissionId: "steer",
        },
      }),
    )!;
    const reconciled = applyAgentRuntimeEnvelope(
      steered,
      event({
        type: "overtchat_turn_update",
        turnId: "turn-1",
        messages: [
          {
            id: "turn-1:user:0",
            role: "user",
            content: "write a paragraph on overtchat",
            overtchatSubmissionId: "prompt",
            overtchatTurnId: "turn-1",
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: [{ type: "text", text: "First paragraph" }],
            overtchatTurnId: "turn-1",
          },
          {
            id: "turn-1:user:1",
            role: "user",
            content: "2 more now",
            overtchatSubmissionId: "steer",
            overtchatTurnId: "turn-1",
          },
          {
            id: "assistant-2",
            role: "assistant",
            content: [{ type: "text", text: "Two more paragraphs" }],
            overtchatTurnId: "turn-1",
          },
          {
            id: "turn-1:footer",
            role: "turnFooter",
            content: "First paragraph\n\nTwo more paragraphs",
            overtchatTurnId: "turn-1",
          },
        ],
      }),
    )!;

    expect(
      reconciled.messages.map((message) =>
        message && typeof message === "object"
          ? [Reflect.get(message, "role"), Reflect.get(message, "id")]
          : null,
      ),
    ).toEqual([
      ["user", "turn-1:user:0"],
      ["assistant", "assistant-1"],
      ["user", "turn-1:user:1"],
      ["assistant", "assistant-2"],
      ["turnFooter", "turn-1:footer"],
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
      error: "Previous runtime error",
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
    expect(settled.error).toBeUndefined();
  });

  it("replaces streamed provider messages by stable message id", () => {
    const initial = {
      ...snapshot(),
      messages: [
        { role: "user", content: "Hello" },
        {
          id: "turn-1:assistant",
          role: "assistant",
          content: [{ type: "text", text: "OVER" }],
          timestamp: 1,
        },
      ],
    };

    const updated = applyAgentRuntimeEnvelope(
      initial,
      event({
        type: "message_update",
        message: {
          id: "turn-1:assistant",
          role: "assistant",
          content: [{ type: "text", text: "OVERTCHAT" }],
          timestamp: 2,
        },
      }),
    )!;

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages.at(-1)).toEqual({
      id: "turn-1:assistant",
      role: "assistant",
      content: [{ type: "text", text: "OVERTCHAT" }],
      timestamp: 2,
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

  it("preserves multi-question interaction forms", () => {
    const next = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "interaction_request",
        id: "opencode:question:1",
        method: "form",
        title: "OpenCode needs your input",
        fields: [{ id: "0", type: "text", label: "Target" }],
      }),
    );
    expect(next?.pendingInteraction).toMatchObject({
      id: "opencode:question:1",
      method: "form",
    });
  });

  it("tracks OvertChat-owned queues and late prompt errors", () => {
    const queued = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_queue_update",
        queuedMessages: [
          {
            id: "queued:1",
            message: "Then summarize",
            status: "pending",
          },
        ],
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
        id: "queued:1",
        message: "Then summarize",
        status: "pending",
      },
    ]);
    expect(queued.messages).toEqual(snapshot().messages);
    expect(failed.error).toBe("Queue rejected");
    expect(failed.queuedMessages).toEqual(queued.queuedMessages);
  });

  it("ignores malformed OvertChat queue updates", () => {
    const current = snapshot();
    expect(
      applyAgentRuntimeEnvelope(
        current,
        event({
          type: "overtchat_queue_update",
          queuedMessages: [
            {
              id: "queued:1",
              message: "Then summarize",
              status: "unknown",
            },
          ],
        }),
      ),
    ).toBe(current);
  });

  it("preserves delivery-uncertain queue updates", () => {
    const updated = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_queue_update",
        queuedMessages: [
          {
            id: "queued:1",
            message: "Then summarize",
            status: "uncertain",
          },
        ],
      }),
    )!;

    expect(updated.queuedMessages).toEqual([
      {
        id: "queued:1",
        message: "Then summarize",
        status: "uncertain",
      },
    ]);
  });

  it("reconciles an accepted submission with the provider user message", () => {
    const submitted = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "Next prompt",
          timestamp: 100,
          overtchatSubmissionId: "submission:1",
        },
      }),
    )!;
    const acknowledged = applyAgentRuntimeEnvelope(
      submitted,
      event({
        type: "message_start",
        message: {
          role: "user",
          content: "Next prompt",
          timestamp: 200,
          overtchatSubmissionId: "submission:1",
        },
      }),
    )!;

    expect(acknowledged.messages).toEqual([
      { role: "user", content: "Hello" },
      {
        role: "user",
        content: "Next prompt",
        timestamp: 100,
        overtchatProviderTimestamp: 200,
        overtchatSubmissionId: "submission:1",
      },
    ]);
  });

  it("reconciles identical submissions by client identity", () => {
    const first = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "Same follow-up",
          timestamp: 100,
          overtchatSubmissionId: "submission:1",
        },
      }),
    )!;
    const second = applyAgentRuntimeEnvelope(
      first,
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "Same follow-up",
          timestamp: 100,
          overtchatSubmissionId: "submission:2",
        },
      }),
    )!;
    const acknowledged = applyAgentRuntimeEnvelope(
      second,
      event({
        type: "message_start",
        message: {
          id: "provider:2",
          role: "user",
          content: "Same follow-up",
          overtchatSubmissionId: "submission:2",
        },
      }),
    )!;

    expect(acknowledged.messages).toEqual([
      { role: "user", content: "Hello" },
      {
        role: "user",
        content: "Same follow-up",
        timestamp: 100,
        overtchatSubmissionId: "submission:1",
      },
      {
        id: "provider:2",
        role: "user",
        content: "Same follow-up",
        timestamp: 100,
        overtchatSubmissionId: "submission:2",
      },
    ]);
  });

  it("removes a submission rejected before the provider starts it", () => {
    const submitted = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_submission",
        message: {
          role: "user",
          content: "Next prompt",
          overtchatSubmissionId: "submission:1",
        },
      }),
    )!;
    const rejected = applyAgentRuntimeEnvelope(
      submitted,
      event({
        type: "overtchat_submission_rejected",
        id: "submission:1",
      }),
    )!;

    expect(rejected.messages).toEqual(snapshot().messages);
  });

  it("preserves image references in queue updates", () => {
    const updated = applyAgentRuntimeEnvelope(
      snapshot(),
      event({
        type: "overtchat_queue_update",
        queuedMessages: [
          {
            id: "session:1",
            message: "",
            images: [
              {
                uploadId: "11111111-1111-4111-8111-111111111111",
                filename: "screen.png",
                mediaType: "image/png",
              },
            ],
            status: "pending",
          },
        ],
      }),
    )!;

    expect(updated.queuedMessages).toEqual([
      {
        id: "session:1",
        message: "",
        images: [
          {
            uploadId: "11111111-1111-4111-8111-111111111111",
            filename: "screen.png",
            mediaType: "image/png",
          },
        ],
        status: "pending",
      },
    ]);
  });

  it("uses authoritative snapshots after live deltas", () => {
    const authoritative = snapshot();
    authoritative.messages.push({
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
    });

    expect(
      applyAgentRuntimeEnvelope(snapshot(), {
        epoch: "runtime",
        sequence: 8,
        type: "snapshot",
        data: authoritative,
      }),
    ).toBe(authoritative);
  });
});
