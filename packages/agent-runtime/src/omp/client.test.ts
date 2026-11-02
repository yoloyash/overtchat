import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentProcess,
  AgentProcessExit,
} from "@overtchat/agent-runtime/runtime/process";
import { buildOmpArgs, OmpClient } from "./client";
import { PiClient } from "../pi/client";
import { applyAgentRuntimeMessageEvent } from "@overtchat/agent-bridge";

class FakeAgentProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly exit: Promise<AgentProcessExit>;
  readonly commands: Array<Record<string, unknown>> = [];
  killedWith: NodeJS.Signals | null = null;
  private resolveExit: (exit: AgentProcessExit) => void = () => {};

  constructor(
    private readonly respond: (
      command: Record<string, unknown>,
      process: FakeAgentProcess,
    ) => void,
  ) {
    this.exit = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    let buffer = "";
    this.stdin.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const command = JSON.parse(buffer.slice(0, newline)) as Record<
          string,
          unknown
        >;
        buffer = buffer.slice(newline + 1);
        this.commands.push(command);
        this.respond(command, this);
      }
    });
  }

  reply(command: Record<string, unknown>, data?: unknown) {
    this.stdout.write(
      `${JSON.stringify({
        type: "response",
        id: command.id,
        command: command.type,
        success: true,
        data,
      })}\n`,
    );
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    this.resolveExit({ code: null, signal });
    return true;
  }
}

function announceReady(process: FakeAgentProcess): void {
  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      protocolVersion: 1,
      supportedProtocolVersions: [1, 2],
      maxFrameBytes: 1024 * 1024,
      maxReassembledFrameBytes: 64 * 1024 * 1024,
    })}\n`,
  );
}

describe("OmpClient", () => {
  it.each(["omp", "pi"])("persists %s manual and automatic compaction as one updated row per operation", async (provider) => {
    const process = new FakeAgentProcess((command, process) => {
      if (command.type !== "compact") process.reply(command, { protocolVersion: 2 });
    });
    const client = provider === "omp" ? new OmpClient(process, "full") : new PiClient(process);
    announceReady(process);
    let messages: unknown[] = [{ id: "old", role: "user", content: "Keep this history" }];
    client.onEvent((event) => { messages = applyAgentRuntimeMessageEvent(messages, event); });
    const pending = client.compact();
    expect(messages).toHaveLength(2);
    const running = messages[1];
    expect(running).toMatchObject({ role: "compactionSummary", status: "running", trigger: "manual" });
    await vi.waitFor(() => expect(process.commands.some((command) => command.type === "compact")).toBe(true));
    process.reply(process.commands.find((command) => command.type === "compact")!, { tokensBefore: 42000, summary: "Private model context" });
    await pending;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ ...(running as object), status: "completed", tokensBefore: 42000 });

    const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
    emit({ type: "auto_compaction_start", reason: "threshold" });
    emit({ type: "auto_compaction_start", reason: "threshold" });
    emit({ type: "auto_compaction_end", result: { tokensBefore: 120000 }, aborted: false });
    emit({ type: "auto_compaction_end", result: { tokensBefore: 120000 }, aborted: false });
    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({ content: "Keep this history" });
    expect(messages[2]).toMatchObject({ role: "compactionSummary", status: "completed", trigger: "auto", tokensBefore: 120000 });
    await client.stop();
  });

  it("builds rpc-ui and approval arguments", () => {
    expect(
      buildOmpArgs({
        executable: "omp",
        model: "openai/gpt-5",
        thinkingOptionId: "high",
        modeId: "ask",
        sessionPath: "/sessions/native.jsonl",
      }),
    ).toEqual([
      "--mode",
      "rpc-ui",
      "--approval-mode",
      "always-ask",
      "--model",
      "openai/gpt-5",
      "--thinking",
      "high",
      "--session",
      "/sessions/native.jsonl",
    ]);
  });

  it("negotiates OMP v2, discovers commands, and pages messages", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "negotiate_protocol") {
        fake.reply(command, { protocolVersion: 2 });
      } else if (command.type === "get_available_commands") {
        fake.reply(command, {
          commands: [
            {
              name: "security",
              description: "Run a security scan",
              input: { hint: "<plan|scan>" },
              source: "builtin",
            },
          ],
        });
      } else if (command.type === "get_messages_page") {
        fake.reply(command, {
          messages:
            command.cursor === "next"
              ? [{ role: "assistant", content: "Done" }]
              : [{ role: "user", content: "Hello" }],
          totalMessages: 2,
          ...(command.cursor ? {} : { nextCursor: "next" }),
        });
      } else {
        fake.reply(command);
      }
    });
    const client = new OmpClient(process, "full");
    announceReady(process);

    await expect(client.getCommands()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "security",
          argumentHint: "<plan|scan>",
          source: "builtin",
        }),
      ]),
    );
    await expect(client.getMessages()).resolves.toEqual({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Done" },
      ],
    });
    expect(process.commands.map((command) => command.type)).toEqual(
      expect.arrayContaining([
        "negotiate_protocol",
        "get_available_commands",
        "get_messages_page",
      ]),
    );
    await client.stop();
  });

  it("does not replay a late native message ID lookup after rewinding", async () => {
    let lookup: Record<string, unknown> | undefined;
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "get_branch_messages") lookup = command;
      else if (command.type === "negotiate_protocol") fake.reply(command, { protocolVersion: 2 });
      else fake.reply(command, { cancelled: false });
    });
    const client = new OmpClient(process, "full");
    announceReady(process);
    const events: unknown[] = [];
    client.onEvent(event => events.push(event));
    process.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "user", content: "Discard me" } })}\n`);
    await vi.waitFor(() => expect(lookup).toBeDefined());
    await client.rewind("native-user", "conversation");
    process.reply(lookup!, { messages: [{ entryId: "native-user", text: "Discard me" }] });
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toHaveLength(1);
    await client.stop();
  });

  it("reassembles OMP v2 response chunks", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "negotiate_protocol") {
        fake.reply(command, { protocolVersion: 2 });
        return;
      }
      const payload = Buffer.from(
        JSON.stringify({
          type: "response",
          id: command.id,
          command: command.type,
          success: true,
          data: { value: "chunked" },
        }),
      );
      const split = Math.ceil(payload.byteLength / 2);
      [payload.subarray(0, split), payload.subarray(split)].forEach(
        (part, index) => {
          fake.stdout.write(
            `${JSON.stringify({
              type: "rpc_chunk",
              chunkId: "chunk-1",
              index,
              count: 2,
              byteLength: payload.byteLength,
              data: part.toString("base64"),
            })}\n`,
          );
        },
      );
    });
    const client = new OmpClient(process, "full");
    announceReady(process);

    await expect(client.getState()).resolves.toMatchObject({ value: "chunked" });
    await client.stop();
  });

  it("sends typed image attachments with prompts and steering", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "negotiate_protocol") {
        fake.reply(command, { protocolVersion: 2 });
        return;
      }
      fake.reply(command);
    });
    const client = new OmpClient(process, "full");
    announceReady(process);
    const image = {
      uploadId: "11111111-1111-4111-8111-111111111111",
      filename: "screen.png",
      mediaType: "image/png" as const,
      data: "aW1hZ2U=",
    };

    await client.prompt("Inspect this", [image]);
    await client.steer("", [image]);

    expect(process.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "prompt",
          message: "Inspect this",
          images: [
            {
              type: "image",
              data: "aW1hZ2U=",
              mimeType: "image/png",
            },
          ],
        }),
        expect.objectContaining({
          type: "steer",
          message: "",
          images: [
            {
              type: "image",
              data: "aW1hZ2U=",
              mimeType: "image/png",
            },
          ],
        }),
      ]),
    );
    await client.stop();
  });

  it("attaches submission identity to provider user-message echoes", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "negotiate_protocol") {
        fake.reply(command, { protocolVersion: 2 });
        return;
      }
      if (command.type === "get_branch_messages") {
        fake.reply(command, { messages: [] });
        return;
      }
      const message = {
        role: "user",
        content: command.message,
        timestamp: command.type === "prompt" ? 100 : 200,
      };
      fake.stdout.write(
        `${JSON.stringify({ type: "message_start", message })}\n`,
      );
      fake.stdout.write(`${JSON.stringify({ type: "message_end", message })}\n`);
      fake.reply(command);
    });
    const client = new OmpClient(process, "full");
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));
    announceReady(process);

    await client.prompt("Start", [], { clientMessageId: "client-prompt" });
    await client.steer("Adjust", [], { clientMessageId: "client-steer" });

    expect(events).toEqual([
      {
        type: "message_start",
        message: expect.objectContaining({
          content: "Start",
          overtchatSubmissionId: "client-prompt",
        }),
      },
      {
        type: "message_end",
        message: expect.objectContaining({
          content: "Start",
          overtchatSubmissionId: "client-prompt",
        }),
      },
      {
        type: "message_start",
        message: expect.objectContaining({
          content: "Adjust",
          overtchatSubmissionId: "client-steer",
        }),
      },
      {
        type: "message_end",
        message: expect.objectContaining({
          content: "Adjust",
          overtchatSubmissionId: "client-steer",
        }),
      },
    ]);
    await client.stop();
  });

  it("surfaces OMP prompt failures emitted after acceptance", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "negotiate_protocol") {
        fake.reply(command, { protocolVersion: 2 });
        return;
      }
      fake.reply(command);
      if (command.type === "prompt") {
        queueMicrotask(() => {
          fake.stdout.write(
            `${JSON.stringify({
              type: "response",
              id: command.id,
              command: "prompt",
              success: false,
              error: "Agent is already processing",
            })}\n`,
          );
        });
      }
    });
    const client = new OmpClient(process, "full");
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));
    announceReady(process);

    await expect(client.prompt("Do this next")).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "rpc_error",
        command: "prompt",
        id: expect.any(String),
        error: "Agent is already processing",
      });
    });
    await client.stop();
  });
});
