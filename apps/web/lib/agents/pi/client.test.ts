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
