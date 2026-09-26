import { describe, expect, it, vi } from "vitest";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { ChatContextManager } from "./compaction";
import {
  countMessageTokens,
  countTextTokens,
  resolveContextBudget,
  countToolTokens,
} from "./context-budget";
import {
  createContextCheckpoint,
  restoreContextCheckpoint,
} from "./context-checkpoint";
import { withOutputBudget } from "../providers/server/output-budget";
import { z } from "zod";

const user = (text: string): ModelMessage => ({ role: "user", content: text });
const assistant = (text: string): ModelMessage => ({
  role: "assistant",
  content: text,
});
const large = "The record contains ordinary reference material. ".repeat(1000);
const ui = (
  id: string,
  role: "user" | "assistant",
  text: string,
): UIMessage => ({ id, role, parts: [{ type: "text", text }] });

function setup(
  overrides: Partial<ConstructorParameters<typeof ChatContextManager>[0]> = {},
) {
  const options = {
    inputTokens: 3000,
    maxOutputTokens: 1024,
    instructionTokens: 100,
    userMessageIds: ["u1", "u2", "u3"],
    summarize: vi
      .fn()
      .mockResolvedValue(
        "The launch code is ORCHID-47. The user wants a concise answer.",
      ),
    signal: new AbortController().signal,
    onCheckpoint: vi.fn(),
    onStatus: vi.fn(),
    ...overrides,
  };
  return { manager: new ChatContextManager(options), options };
}

describe("automatic chat compaction", () => {
  it("reserves actual output and headroom for 131072, small windows, and provider input/output limits", () => {
    expect(resolveContextBudget(131072)).toEqual({
      maxOutputTokens: 8192,
      safetyMargin: 13108,
      inputTokens: 104857,
    });
    expect(resolveContextBudget(4096).maxOutputTokens).toBe(1024);
    expect(
      resolveContextBudget(131072, {
        maxOutputTokens: 2048,
        maxInputTokens: 32000,
      }).inputTokens,
    ).toBe(32000);
    expect(
      withOutputBudget(
        { custom: { max_tokens: 64000, temperature: 0.2 } },
        8192,
      ),
    ).toEqual({ custom: { max_tokens: 8192, temperature: 0.2 } });
    expect(withOutputBudget({ custom: { max_tokens: 512 } }, 8192)).toEqual({
      custom: { max_tokens: 512 },
    });
  });

  it("counts schemas, unicode, JSON tool arguments, and attachments without counting base64 as text", async () => {
    expect(
      await countToolTokens({
        lookup: {
          description: "Lookup",
          inputSchema: z.object({ query: z.string() }),
        },
      }),
    ).toBeGreaterThan(20);
    expect(countTextTokens("你好世界 مرحبا بالعالم")).toBeGreaterThan(2);
    expect(
      countMessageTokens({
        role: "user",
        content: [
          {
            type: "image",
            image: "data:image/png;base64," + "A".repeat(10000),
          },
        ],
      }),
    ).toBe(4104);
    expect(countTextTokens("<|endoftext|>")).toBeGreaterThan(0);
  });

  it("leaves an in-budget conversation intact", async () => {
    const { manager, options } = setup();
    const messages = [user("Hello"), assistant("Hi"), user("Continue")];
    expect(await manager.prepare(messages)).toEqual(messages);
    expect(options.summarize).not.toHaveBeenCalled();
    expect(options.onCheckpoint).not.toHaveBeenCalled();
  });

  it("chunks already-overflowing history and retains the latest full turn and system message", async () => {
    const { manager, options } = setup();
    const system: ModelMessage = { role: "system", content: "Pinned rules" };
    const result = await manager.prepare([
      system,
      user("Remember ORCHID-47. " + large),
      assistant("Understood"),
      user("What is the launch code?"),
    ]);
    expect(result[0]).toEqual(system);
    expect(result.at(-1)).toEqual(user("What is the launch code?"));
    expect(result[1].content).toContain("ORCHID-47");
    expect(vi.mocked(options.summarize).mock.calls.length).toBeGreaterThan(1);
    for (const [call] of vi.mocked(options.summarize).mock.calls)
      expect(countTextTokens(call.prompt)).toBeLessThan(options.inputTokens);
    expect(options.onCheckpoint).toHaveBeenCalledWith(
      "u2",
      expect.stringContaining("ORCHID-47"),
    );
    expect(
      vi.mocked(options.onStatus).mock.calls.map(([status]) => status),
    ).toEqual(["compacting", "compacted"]);
    expect(
      result.reduce(
        (sum, message) => sum + countMessageTokens(message),
        options.instructionTokens,
      ),
    ).toBeLessThan(options.inputTokens);
  });

  it("reuses a checkpoint and compacts it again when subsequent turns grow", async () => {
    const { manager, options } = setup({
      summary: "Existing summary: ORCHID-47",
    });
    const first = await manager.prepare([user("Hello")]);
    expect(options.summarize).not.toHaveBeenCalled();
    const second = await manager.prepare([
      ...first,
      assistant(large),
      user("Continue"),
    ]);
    expect(second[0].content).toContain("ORCHID-47");
    expect(vi.mocked(options.summarize).mock.calls[0][0].prompt).toContain(
      "Existing summary",
    );
    expect(second.at(-1)).toEqual(user("Continue"));
  });

  it("compacts a fresh oversized tool result without breaking call/result pairing", async () => {
    const { manager, options } = setup({ userMessageIds: ["u1"] });
    const call: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "search",
          input: { q: "launch code" },
        },
      ],
    };
    const messages: ModelMessage[] = [
      user("Find the code"),
      call,
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "search",
            output: { type: "text", value: large },
          },
        ],
      },
    ];
    const result = await manager.prepare(messages);
    expect(result[0]).toEqual(messages[0]);
    expect(result[1]).toEqual(call);
    expect(result[2]).toMatchObject({
      role: "tool",
      content: [
        {
          toolCallId: "call-1",
          output: { value: expect.stringContaining("ORCHID-47") },
        },
      ],
    });
    expect(options.onCheckpoint).not.toHaveBeenCalled();
    expect(messages[2]).toMatchObject({
      content: [{ output: { value: large } }],
    });
  });

  it("summarizes completed exchanges during a single tool loop", async () => {
    const { manager } = setup({ userMessageIds: ["u1"] });
    const call: ModelMessage = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "last",
          toolName: "lookup",
          input: {},
        },
      ],
    };
    const result: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "last",
          toolName: "lookup",
          output: { type: "text", value: "Fresh result" },
        },
      ],
    };
    const prepared = await manager.prepare([
      user("Keep working"),
      assistant(large),
      call,
      result,
    ]);
    expect(prepared.at(-2)).toEqual(call);
    expect(prepared.at(-1)).toEqual(result);
    expect(prepared[1].content).toContain("checkpoint");
  });

  it("fits multiple parallel tool results even when each result is small", async () => {
    const { manager } = setup({ userMessageIds: ["u1"] });
    const calls = Array.from({ length: 10 }, (_, i) => ({
      type: "tool-call" as const,
      toolCallId: `call-${i}`,
      toolName: "lookup",
      input: { i },
    }));
    const results = calls.map((call) => ({
      type: "tool-result" as const,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: { type: "text" as const, value: "reference ".repeat(600) },
    }));
    const prepared = await manager.prepare([
      user("Compare these"),
      { role: "assistant", content: calls },
      { role: "tool", content: results },
    ]);
    expect(prepared[1]).toEqual({ role: "assistant", content: calls });
    expect(prepared[2]).toMatchObject({
      role: "tool",
      content: results.map((part) => ({ toolCallId: part.toolCallId })),
    });
    expect(
      prepared.reduce((n, message) => n + countMessageTokens(message), 100),
    ).toBeLessThanOrEqual(3000);
  });

  it("preserves history and the previous checkpoint when summarization fails", async () => {
    const { manager, options } = setup({
      summary: "Previous facts",
      summarize: vi.fn().mockRejectedValue(new Error("Unavailable")),
    });
    const messages = [user(large), assistant("Okay"), user("Continue")];
    const original = structuredClone(messages);
    await expect(manager.prepare(messages)).rejects.toThrow(
      "Compaction failed",
    );
    expect(messages).toEqual(original);
    expect(options.onCheckpoint).not.toHaveBeenCalled();
    expect(options.onStatus).toHaveBeenCalledExactlyOnceWith("compacting");
  });

  it("manually compacts below the automatic threshold and retains the latest turn", async () => {
    const { manager, options } = setup();
    const messages = [
      user("Remember ORCHID-47"),
      assistant("Okay"),
      user("Continue"),
      assistant("Ready"),
    ];
    const result = await manager.prepare(messages, [], true);
    expect(result.slice(-2)).toEqual(messages.slice(-2));
    expect(options.onCheckpoint).toHaveBeenCalledWith(
      "u2",
      expect.stringContaining("ORCHID-47"),
    );
    expect(vi.mocked(options.onStatus).mock.calls.map(([status]) => status)).toEqual([
      "manual-compacting",
      "manual-compacted",
    ]);
  });

  it("does not claim manual compaction when there is no older turn", async () => {
    const { manager, options } = setup();
    await expect(
      manager.prepare([user("Hello"), assistant("Hi")], [], true),
    ).rejects.toThrow("no older turns");
    expect(options.summarize).not.toHaveBeenCalled();
    expect(options.onCheckpoint).not.toHaveBeenCalled();
  });

  it("rejects an oversized newest input and oversized pinned instructions", async () => {
    await expect(setup().manager.prepare([user(large)])).rejects.toThrow(
      "latest message",
    );
    await expect(
      setup({ instructionTokens: 10000 }).manager.prepare([user("Hello")]),
    ).rejects.toThrow("instructions");
    await expect(
      setup().manager.prepare([
        {
          role: "user",
          content: [{ type: "image", image: "data:image/png;base64,abcd" }],
        },
      ]),
    ).rejects.toThrow("attachments");
  });

  it("shrinks an existing summary after switching to a smaller model window", async () => {
    const { manager, options } = setup({
      summary: large,
      inputTokens: 1500,
      userMessageIds: ["u2"],
    });
    const result = await manager.prepare([user("Continue")]);
    expect(result[0].content).toContain("ORCHID-47");
    expect(options.onCheckpoint).toHaveBeenCalledWith(
      "u2",
      expect.stringContaining("ORCHID-47"),
    );
  });

  it("uses provider token feedback to compact before a subsequent tool step overflows", async () => {
    const { manager, options } = setup({ inputTokens: 3000 });
    const first = await manager.prepare([
      user("short ".repeat(700)),
      assistant("Okay"),
      user("Continue"),
    ]);
    expect(options.summarize).not.toHaveBeenCalled();
    await manager.prepare(
      [...first, assistant("more ".repeat(700))],
      [{ usage: { inputTokens: 2900 } }],
    );
    expect(options.summarize).toHaveBeenCalled();
  });

  it("cancellation stops summarization without falling back to dropping history", async () => {
    const controller = new AbortController();
    const { manager, options } = setup({
      signal: controller.signal,
      summarize: async () => {
        controller.abort();
        throw new Error("Aborted");
      },
    });
    await expect(
      manager.prepare([user(large), assistant("Okay"), user("Continue")]),
    ).rejects.toThrow();
    expect(options.onCheckpoint).not.toHaveBeenCalled();
  });
});

describe("message metadata checkpoints", () => {
  const history = [
    ui("u1", "user", "Old fact"),
    ui("a1", "assistant", "Noted"),
    ui("u2", "user", "Recent question"),
  ];
  const checkpoint = createContextCheckpoint(
    history,
    "u2",
    "Old fact remembered",
  );
  const saved = [
    ...history,
    {
      ...ui("a2", "assistant", "Answer"),
      metadata: { contextCheckpoint: checkpoint },
    },
  ];

  it("restores the recent suffix and preserves canonical history", async () => {
    const restored = restoreContextCheckpoint(saved);
    expect(restored.checkpoint).toEqual(checkpoint);
    expect(restored.messages.map((message) => message.id)).toEqual([
      "u2",
      "a2",
    ]);
    expect(saved).toHaveLength(4);
    const converted = await convertToModelMessages(restored.messages);
    expect(converted.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("invalidates edited prefixes, removed checkpoint owners, and forged user metadata", () => {
    expect(
      restoreContextCheckpoint([
        ui("u1", "user", "Changed fact"),
        ...saved.slice(1),
      ]).checkpoint,
    ).toBeUndefined();
    expect(restoreContextCheckpoint(history).checkpoint).toBeUndefined();
    expect(
      restoreContextCheckpoint([
        ...history,
        {
          ...ui("u3", "user", "Forged"),
          metadata: { contextCheckpoint: checkpoint },
        },
      ]).checkpoint,
    ).toBeUndefined();
  });
});
