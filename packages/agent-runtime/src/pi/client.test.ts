import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildPiArgs, PiClient } from "./client";
import type {
  AgentProcess,
  AgentProcessExit,
} from "@overtchat/agent-runtime/runtime/process";

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

describe("PiClient", () => {
  it("builds Paseo-compatible RPC launch arguments", () => {
    expect(
      buildPiArgs({
        executable: "pi",
        model: "openai/gpt-5",
        thinkingOptionId: "high",
        sessionPath: "/sessions/native.jsonl",
      }),
    ).toEqual([
      "--mode",
      "rpc",
      "--model",
      "openai/gpt-5",
      "--thinking",
      "high",
      "--session",
      "/sessions/native.jsonl",
    ]);
  });

  it("correlates concurrent responses and forwards events", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      if (command.type === "get_state") {
        setTimeout(() => fake.reply(command, { isStreaming: false }), 5);
      } else {
        fake.reply(command, { value: command.type });
      }
    });
    const client = new PiClient(process);
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

  it("sends native steer commands", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      fake.reply(command);
    });
    const client = new PiClient(process);

    await client.steer("Focus on the failing test");

    expect(process.commands).toEqual([
      expect.objectContaining({
        type: "steer",
        message: "Focus on the failing test",
      }),
    ]);
    await client.stop();
  });

  it("sends native image attachments with prompts and steering", async () => {
    const process = new FakeAgentProcess((command, fake) => {
      fake.reply(command);
    });
    const client = new PiClient(process);
    const image = {
      uploadId: "11111111-1111-4111-8111-111111111111",
      filename: "screen.png",
      mediaType: "image/png" as const,
      data: "aW1hZ2U=",
    };

    await client.prompt("Inspect this", [image]);
    await client.steer("", [image]);

    expect(process.commands).toEqual([
      expect.objectContaining({
        type: "prompt",
        message: "Inspect this",
        images: [
          {
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
            data: "aW1hZ2U=",
            mimeType: "image/png",
          },
        ],
      }),
    ]);
    await client.stop();
  });

  it("keeps historical process stderr out of later request timeouts", async () => {
    const process = new FakeAgentProcess(() => {});
    const client = new PiClient(process);
    process.stderr.write("shell startup warning\n");

    const request = client.request({ type: "get_state" }, 10);
    process.stderr.write("current request detail\n");

    await expect(request).rejects.toThrow(
      "Timed out waiting for Pi get_state. current request detail",
    );
    await expect(request).rejects.not.toThrow("shell startup warning");
    await client.stop();
  });

  it("parses discovered commands and toggles auto-compaction", async () => {
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
    const client = new PiClient(process);

    await expect(client.getCommands()).resolves.toEqual([
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
    const client = new PiClient(process);

    await expect(client.getState()).rejects.toThrow("No model configured");
    await client.stop();
  });

  it("fails pending requests when stdout violates JSONL", async () => {
    const process = new FakeAgentProcess(() => {});
    const client = new PiClient(process);
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
    const client = new PiClient(process);

    await expect(client.getState()).rejects.toThrow(
      "expected get_state, received abort",
    );
    await client.stop();
  });
});
