import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CodexAppServer } from "./app-server";
import type {
  AgentProcess,
  AgentProcessExit,
} from "@/lib/agents/runtime/process";

class FakeAgentProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly exit: Promise<AgentProcessExit>;
  readonly frames: Array<Record<string, unknown>> = [];
  killedWith: NodeJS.Signals | null = null;
  private resolveExit: (exit: AgentProcessExit) => void = () => {};

  constructor(
    private readonly handle: (
      frame: Record<string, unknown>,
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
        if (newline < 0) break;
        const frame = JSON.parse(buffer.slice(0, newline)) as Record<
          string,
          unknown
        >;
        buffer = buffer.slice(newline + 1);
        this.frames.push(frame);
        this.handle(frame, this);
      }
    });
  }

  result(frame: Record<string, unknown>, result: unknown): void {
    this.stdout.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: frame.id, result })}\n`,
    );
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    this.resolveExit({ code: null, signal });
    return true;
  }
}

describe("CodexAppServer", () => {
  it("initializes, correlates requests, and forwards notifications", async () => {
    const process = new FakeAgentProcess((frame, fake) => {
      if (frame.method === "initialize") {
        fake.result(frame, { userAgent: "codex", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" });
      } else if (frame.method === "model/list") {
        fake.result(frame, { data: [], nextCursor: null });
      }
    });
    const server = new CodexAppServer(process);
    const notifications: unknown[] = [];
    server.onNotification((notification) => notifications.push(notification));

    await server.ready();
    await expect(server.request("model/list", {})).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: "thread", turn: { id: "turn" } },
      })}\n`,
    );

    expect(process.frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "initialize" }),
        { jsonrpc: "2.0", method: "initialized" },
        expect.objectContaining({ method: "model/list" }),
      ]),
    );
    expect(notifications).toContainEqual({
      method: "turn/started",
      params: { threadId: "thread", turn: { id: "turn" } },
    });
    await server.stop();
  });

  it("allows clients to answer server-initiated requests", async () => {
    const process = new FakeAgentProcess((frame, fake) => {
      if (frame.method === "initialize") fake.result(frame, {});
    });
    const server = new CodexAppServer(process);
    server.onRequest((request) => {
      server.respond(request.id, { decision: "accept" });
    });
    await server.ready();

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: { command: "npm test" },
      })}\n`,
    );
    await vi.waitFor(() => {
      expect(process.frames).toContainEqual({
        jsonrpc: "2.0",
        id: "approval-1",
        result: { decision: "accept" },
      });
    });
    await server.stop();
  });

  it("kills the process and rejects requests after malformed JSON", async () => {
    const process = new FakeAgentProcess((frame, fake) => {
      if (frame.method === "initialize") fake.result(frame, {});
    });
    const server = new CodexAppServer(process);
    await server.ready();
    const request = server.request("model/list", {});
    await vi.waitFor(() => {
      expect(process.frames).toContainEqual(
        expect.objectContaining({ method: "model/list" }),
      );
    });
    process.stdout.write("{broken\n");

    await expect(request).rejects.toThrow("invalid JSON");
    expect(process.killedWith).toBe("SIGKILL");
  });
});
