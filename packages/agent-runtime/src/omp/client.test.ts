import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type {
  AgentProcess,
  AgentProcessExit,
} from "@overtchat/agent-runtime/runtime/process";
import { buildOmpArgs, OmpClient } from "./client";

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
