import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";


const mocks = vi.hoisted(() => ({
  spawnOnHost: vi.fn(),
}));

vi.mock("@overtchat/agent-runtime/runtime/process", () => ({
  spawnOnHost: mocks.spawnOnHost,
}));

import { CodexAppServer, startCodexAppServer } from "./app-server";
import type {
  AgentProcess,
  AgentProcessExit,
} from "@overtchat/agent-runtime/runtime/process";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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

class FailedAgentProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly exit: Promise<AgentProcessExit>;
  killedWith: NodeJS.Signals | null = null;

  constructor(message: string) {
    this.stderr.end(message);
    this.exit = Promise.resolve({ code: 1, signal: null });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    return true;
  }
}

class FakeProxyProcess implements AgentProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly exit: Promise<AgentProcessExit>;
  readonly frames: Array<Record<string, unknown>> = [];
  killedWith: NodeJS.Signals | null = null;
  private resolveExit: (exit: AgentProcessExit) => void = () => {};
  private input = Buffer.alloc(0);
  private upgraded = false;

  constructor() {
    this.exit = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    this.stdin.on("data", (chunk) => {
      this.input = Buffer.concat([this.input, Buffer.from(chunk)]);
      this.consume();
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedWith = signal;
    this.resolveExit({ code: null, signal });
    return true;
  }

  private consume(): void {
    if (!this.upgraded) {
      const boundary = this.input.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const request = this.input.subarray(0, boundary).toString();
      this.input = this.input.subarray(boundary + 4);
      const key = /^Sec-WebSocket-Key:\s*(.+)$/imu.exec(request)?.[1]?.trim();
      if (!key) throw new Error("WebSocket upgrade did not include a key.");
      const accept = createHash("sha1")
        .update(`${key}${WEBSOCKET_GUID}`)
        .digest("base64");
      this.stdout.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${accept}`,
          "",
          "",
        ].join("\r\n"),
      );
      this.upgraded = true;
    }

    for (;;) {
      const frame = this.readFrame();
      if (!frame) return;
      if (frame.opcode === 0x8) return;
      if (frame.opcode !== 0x1) continue;
      const value = JSON.parse(frame.payload.toString()) as Record<
        string,
        unknown
      >;
      this.frames.push(value);
      if (typeof value.id === "number" && typeof value.method === "string") {
        this.sendJson({
          jsonrpc: "2.0",
          id: value.id,
          result:
            value.method === "model/list"
              ? { data: [], nextCursor: null }
              : {},
        });
      }
    }
  }

  private readFrame(): { opcode: number; payload: Buffer } | null {
    if (this.input.length < 2) return null;
    const opcode = this.input[0] & 0x0f;
    const masked = (this.input[1] & 0x80) !== 0;
    let length = this.input[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (this.input.length < 4) return null;
      length = this.input.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (this.input.length < 10) return null;
      const extended = this.input.readBigUInt64BE(2);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket test frame is too large.");
      }
      length = Number(extended);
      offset = 10;
    }
    const maskLength = masked ? 4 : 0;
    if (this.input.length < offset + maskLength + length) return null;
    const mask = masked ? this.input.subarray(offset, offset + 4) : null;
    offset += maskLength;
    const payload = Buffer.from(this.input.subarray(offset, offset + length));
    this.input = this.input.subarray(offset + length);
    if (mask) {
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }
    return { opcode, payload };
  }

  private sendJson(value: unknown): void {
    const payload = Buffer.from(JSON.stringify(value));
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    this.stdout.write(Buffer.concat([header, payload]));
  }
}

describe("CodexAppServer", () => {
  beforeEach(() => {
    mocks.spawnOnHost.mockReset();
  });

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

  it("prefers the shared Codex daemon through app-server proxy", async () => {
    const process = new FakeProxyProcess();
    mocks.spawnOnHost.mockReturnValueOnce(process);

    const server = await startCodexAppServer(
      { transport: "local" },
      "/opt/bin/codex",
      "/workspace",
      { enableGoals: true },
    );
    await expect(server.request("model/list")).resolves.toEqual({
      data: [],
      nextCursor: null,
    });

    expect(mocks.spawnOnHost).toHaveBeenCalledOnce();
    expect(mocks.spawnOnHost).toHaveBeenCalledWith(
      { transport: "local" },
      {
        command: "/opt/bin/codex",
        args: ["app-server", "proxy", "--enable", "goals"],
        cwd: "/workspace",
      },
    );
    expect(process.frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "initialize" }),
        { jsonrpc: "2.0", method: "initialized" },
        expect.objectContaining({ method: "model/list" }),
      ]),
    );
    await server.stop();
  });

  it("falls back to standalone stdio when the daemon proxy is unavailable", async () => {
    const proxy = new FailedAgentProcess("daemon unavailable");
    const standalone = new FakeAgentProcess((frame, fake) => {
      if (frame.method === "initialize") fake.result(frame, {});
      if (frame.method === "model/list") {
        fake.result(frame, { data: [], nextCursor: null });
      }
    });
    mocks.spawnOnHost
      .mockReturnValueOnce(proxy)
      .mockReturnValueOnce(standalone);

    const server = await startCodexAppServer(
      { transport: "ssh", alias: "devbox" },
      "codex",
      "/workspace",
      { enableGoals: true },
    );
    await expect(server.request("model/list")).resolves.toEqual({
      data: [],
      nextCursor: null,
    });

    expect(mocks.spawnOnHost).toHaveBeenNthCalledWith(
      1,
      { transport: "ssh", alias: "devbox" },
      {
        command: "codex",
        args: ["app-server", "proxy", "--enable", "goals"],
        cwd: "/workspace",
      },
    );
    expect(mocks.spawnOnHost).toHaveBeenNthCalledWith(
      2,
      { transport: "ssh", alias: "devbox" },
      {
        command: "codex",
        args: ["app-server", "--enable", "goals", "--stdio"],
        cwd: "/workspace",
      },
    );
    await server.stop();
  });
});
