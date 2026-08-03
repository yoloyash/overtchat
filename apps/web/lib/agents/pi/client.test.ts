import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PiRpcClient } from "./client";
import type {
  AgentProcess,
  AgentProcessExit,
} from "@/lib/agents/runtime/process";

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

describe("PiRpcClient", () => {
  it("correlates concurrent responses and forwards events", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "get_state") {
        setTimeout(() => fake.reply(command, { isStreaming: false }), 5);
      } else {
        fake.reply(command, { value: command.type });
      }
    });
    const client = new PiRpcClient(process);
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));

    const state = client.getState();
    const abort = client.abort();
    process.stdout.write(
      `${JSON.stringify({ type: "turn_start", turnId: "turn" })}\n`,
    );

    await expect(state).resolves.toEqual({ isStreaming: false });
    await expect(abort).resolves.toEqual({ value: "abort" });
    expect(events).toContainEqual({ type: "turn_start", turnId: "turn" });
    await client.stop();
  });

  it("merges built-ins with discovered commands and toggles auto-compaction", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "get_commands") {
        fake.reply(command, {
          commands: [
            {
              name: "skill:docs",
              description: "Read docs",
              source: "skill",
            },
          ],
        });
      } else {
        fake.reply(command);
      }
    });
    const client = new PiRpcClient(process);

    await expect(client.getCommands()).resolves.toEqual([
      expect.objectContaining({ name: "new", source: "builtin" }),
      expect.objectContaining({ name: "compact", source: "builtin" }),
      expect.objectContaining({ name: "autocompact", source: "builtin" }),
      expect.objectContaining({ name: "name", source: "builtin" }),
      {
        name: "skill:docs",
        description: "Read docs",
        source: "skill",
      },
    ]);
    await client.setAutoCompaction(false);
    expect(process.commands.at(-1)).toMatchObject({
      type: "set_auto_compaction",
      enabled: false,
    });
    await client.stop();
  });

  it("negotiates OMP v2, discovers its commands, and pages messages", async () => {
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
    const client = new PiRpcClient(process, "omp");
    process.stdout.write(
      `${JSON.stringify({
        type: "ready",
        protocolVersion: 1,
        supportedProtocolVersions: [1, 2],
        maxFrameBytes: 1024 * 1024,
        maxReassembledFrameBytes: 64 * 1024 * 1024,
      })}\n`,
    );

    await expect(client.getCommands()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "new", source: "builtin" }),
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
    await expect(client.getAvailableThinkingLevels()).resolves.toContain(
      "xhigh",
    );
    expect(process.commands.map((command) => command.type)).toEqual(
      expect.arrayContaining([
        "negotiate_protocol",
        "get_available_commands",
        "get_messages_page",
      ]),
    );
    expect(process.commands).not.toContainEqual(
      expect.objectContaining({ type: "get_available_thinking_levels" }),
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
    const client = new PiRpcClient(process, "omp");
    process.stdout.write(
      `${JSON.stringify({
        type: "ready",
        protocolVersion: 1,
        supportedProtocolVersions: [1, 2],
        maxFrameBytes: 1024 * 1024,
        maxReassembledFrameBytes: 64 * 1024 * 1024,
      })}\n`,
    );

    await expect(client.getState()).resolves.toEqual({
      value: "chunked",
    });
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
    const client = new PiRpcClient(process, "omp");
    const events: unknown[] = [];
    client.onEvent((event) => events.push(event));
    process.stdout.write(
      `${JSON.stringify({
        type: "ready",
        protocolVersion: 1,
        supportedProtocolVersions: [1, 2],
        maxFrameBytes: 1024 * 1024,
        maxReassembledFrameBytes: 64 * 1024 * 1024,
      })}\n`,
    );

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

  it("rejects a failed command with Pi's error", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      fake.stdout.write(
        `${JSON.stringify({
          type: "response",
          id: command.id,
          command: command.type,
          success: false,
          error: "No model configured",
        })}\n`,
      );
    });
    const client = new PiRpcClient(process);

    await expect(client.getState()).rejects.toThrow("No model configured");
    await client.stop();
  });

  it("fails pending requests when stdout violates JSONL", async () => {
    const process = new FakeAgentProcess(() => {});
    const client = new PiRpcClient(process);
    const state = client.getState();

    process.stdout.write("not-json\n");

    await expect(state).rejects.toThrow("invalid JSON");
    expect(process.killedWith).toBe("SIGKILL");
  });

  it("rejects mismatched command responses", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      fake.stdout.write(
        `${JSON.stringify({
          type: "response",
          id: command.id,
          command: "abort",
          success: true,
        })}\n`,
      );
    });
    const client = new PiRpcClient(process);

    await expect(client.getState()).rejects.toThrow(
      "expected get_state, received abort",
    );
    await client.stop();
  });
});
