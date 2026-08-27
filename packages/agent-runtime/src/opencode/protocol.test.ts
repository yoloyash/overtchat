import { describe, expect, it } from "vitest";
import type { Message, Part, Provider, Session } from "@opencode-ai/sdk/v2/client";
import {
  openCodeSessionMetadata,
  parseOpenCodeModels,
  parseOpenCodeModes,
  parseOpenCodeStats,
  projectOpenCodeMessages,
  type OpenCodeMessageWithParts,
} from "./protocol";

const provider = {
  id: "openai",
  name: "OpenAI",
  source: "api",
  models: {
    "gpt-test": {
      id: "gpt-test",
      name: "GPT Test",
      family: "gpt",
      api: { id: "gpt-test", url: "https://example.test" },
      capabilities: {
        reasoning: true,
        attachment: true,
        input: { text: true, audio: false, image: true, video: false, pdf: false },
      },
      variants: { high: {} },
      limit: { context: 128_000, output: 16_000 },
      cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
    },
  },
} as unknown as Provider;

const user = {
  id: "msg-user",
  sessionID: "ses-1",
  role: "user",
  time: { created: 100 },
  agent: "build",
  model: { providerID: "openai", modelID: "gpt-test" },
} as Message;

const assistant = {
  id: "msg-assistant",
  sessionID: "ses-1",
  role: "assistant",
  time: { created: 200, completed: 300 },
  parentID: "msg-user",
  modelID: "gpt-test",
  providerID: "openai",
  mode: "build",
  agent: "build",
  path: { cwd: "/workspace", root: "/workspace" },
  cost: 0.25,
  tokens: {
    input: 10,
    output: 5,
    reasoning: 2,
    cache: { read: 3, write: 1 },
  },
} as Message;

const messages: OpenCodeMessageWithParts[] = [
  {
    info: user,
    parts: [
      {
        id: "part-user",
        sessionID: "ses-1",
        messageID: "msg-user",
        type: "text",
        text: "Fix the test",
      } as Part,
    ],
  },
  {
    info: assistant,
    parts: [
      {
        id: "part-reasoning",
        sessionID: "ses-1",
        messageID: "msg-assistant",
        type: "reasoning",
        text: "Inspecting",
        time: { start: 201, end: 210 },
      } as Part,
      {
        id: "part-text",
        sessionID: "ses-1",
        messageID: "msg-assistant",
        type: "text",
        text: "Done",
      } as Part,
      {
        id: "part-tool",
        sessionID: "ses-1",
        messageID: "msg-assistant",
        type: "tool",
        callID: "call-1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "npm test" },
          output: "passed",
          title: "Run tests",
          metadata: {},
          time: { start: 220, end: 250 },
          attachments: [],
        },
      } as Part,
    ],
  },
];

describe("OpenCode protocol projection", () => {
  it("maps connected models and arbitrary variants", () => {
    expect(
      parseOpenCodeModels(
        {
          all: [provider],
          connected: ["openai"],
          default: { openai: "gpt-test" },
        },
        "openai/gpt-test",
      ),
    ).toEqual([
      expect.objectContaining({
        provider: "opencode",
        id: "openai/gpt-test",
        isDefault: true,
        input: ["text", "image"],
        contextWindow: 128_000,
        defaultThinkingOptionId: "default",
        thinkingOptions: [
          { id: "default", label: "Default", isDefault: true },
          { id: "high", label: "high" },
        ],
      }),
    ]);
  });

  it("projects streaming content, tools, and durable submission identity", () => {
    const projected = projectOpenCodeMessages(messages, {
      "msg-user": "client-message-1",
    });
    expect(projected).toEqual([
      expect.objectContaining({
        id: "msg-user",
        role: "user",
        overtchatSubmissionId: "client-message-1",
      }),
      expect.objectContaining({
        id: "msg-assistant",
        role: "assistant",
        content: [
          expect.objectContaining({ type: "thinking", thinking: "Inspecting" }),
          expect.objectContaining({ type: "text", text: "Done" }),
          expect.objectContaining({ type: "toolCall", id: "call-1", name: "bash" }),
        ],
      }),
      expect.objectContaining({
        role: "toolResult",
        toolCallId: "call-1",
        isError: false,
      }),
    ]);
    expect(parseOpenCodeStats(messages, 128_000)).toMatchObject({
      sessionId: "ses-1",
      userMessages: 1,
      assistantMessages: 1,
      toolCalls: 1,
      tokens: { input: 10, output: 7, cacheRead: 3, cacheWrite: 1, total: 21 },
      cost: 0.25,
    });
  });

  it("maps agents and persisted sessions", () => {
    expect(
      parseOpenCodeModes([
        { name: "build", mode: "primary", description: "Build things" },
        { name: "helper", mode: "subagent", description: "Hidden helper" },
      ] as never),
    ).toEqual([
      { id: "build", label: "Build", description: "Build things" },
    ]);
    const session = {
      id: "ses-1",
      title: "Repair",
      time: { created: 100, updated: 300 },
      model: { providerID: "openai", id: "gpt-test", variant: "high" },
      agent: "build",
    } as Session;
    expect(openCodeSessionMetadata(session, messages)).toEqual({
      providerSessionId: "ses-1",
      providerSessionPath: "ses-1",
      name: "Repair",
      firstMessage: "Fix the test",
      messageCount: 2,
      createdAt: new Date(100),
      modifiedAt: new Date(300),
      launchConfig: {
        model: "openai/gpt-test",
        thinkingOptionId: "high",
        modeId: "build",
      },
    });
  });
});
