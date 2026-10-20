import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WINDOWS_INPUT_SCRIPT } from "./windows-input.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  const input = new PassThrough();
  const process = {
    stdin: input,
    stderr: { write: vi.fn() },
    exit: vi.fn(),
    exitCode: 0,
  };
  const callbacks: Array<() => void> = [];
  const received: Buffer[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      received.push(Buffer.from(chunk));
      callbacks.push(callback);
    },
  });
  const child = Object.assign(new EventEmitter(), { stdin });
  new Function(
    "process",
    "child",
    "Buffer",
    "Date",
    "setInterval",
    "clearInterval",
    WINDOWS_INPUT_SCRIPT,
  )(process, child, Buffer, Date, setInterval, clearInterval);
  const send = (frame: unknown) => input.write(JSON.stringify(frame) + "\n");
  return { process, input, child, callbacks, received, send };
}

describe("Windows input liveness", () => {
  it("accepts fragmented frames and multiple frames in one transport chunk", () => {
    const f = fixture();
    const frame = JSON.stringify({
      type: "data",
      data: Buffer.from("雪").toString("base64"),
    });
    f.input.write(frame.slice(0, 7));
    expect(f.received).toEqual([]);
    f.input.write(frame.slice(7) + '\n{"type":"ping"}\n{"type":"end"}\n');
    expect(Buffer.concat(f.received).toString()).toBe("雪");
    expect(f.child.stdin.writableEnded).toBe(true);
    expect(f.process.exit).not.toHaveBeenCalled();
  });
  it("processes heartbeats during backpressure and preserves data/EOF order", async () => {
    const f = fixture();
    const first = Buffer.alloc(32768, 1),
      second = Buffer.alloc(32768, 2);
    f.send({ type: "data", data: first.toString("base64") });
    f.send({ type: "data", data: second.toString("base64") });
    f.send({ type: "end" });
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(5000);
      f.send({ type: "ping" });
    }
    expect(f.process.exit).not.toHaveBeenCalled();
    expect(f.child.stdin.writableFinished).toBe(false);
    f.callbacks.shift()!();
    f.callbacks.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(Buffer.concat(f.received)).toEqual(Buffer.concat([first, second]));
    expect(f.child.stdin.writableFinished).toBe(true);
    f.child.emit("close", 7);
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.process.exitCode).toBe(7);
    expect(f.process.exit).not.toHaveBeenCalled();
  });
  it("expires a lost owner even while the child is not reading", async () => {
    const f = fixture();
    f.send({ type: "data", data: Buffer.alloc(32768).toString("base64") });
    await vi.advanceTimersByTimeAsync(31000);
    expect(f.process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
  it("handles transport EOF without waiting for the child to read", async () => {
    const f = fixture();
    f.send({ type: "data", data: Buffer.alloc(32768).toString("base64") });
    f.input.end();
    await new Promise<void>((resolve) => f.input.once("end", resolve));
    expect(f.process.exit).toHaveBeenCalledWith(1);
  });
  it("bounds pending agent input instead of allocating indefinitely", () => {
    const f = fixture();
    const frame = {
      type: "data",
      data: Buffer.alloc(32768).toString("base64"),
    };
    for (let i = 0; i < 2049; i++) f.send(frame);
    expect(f.process.exit).toHaveBeenCalledWith(1);
    expect(f.child.stdin.writableLength).toBe(64 * 1024 * 1024);
    expect(f.process.stderr.write).toHaveBeenCalledWith(
      expect.stringContaining("64 MiB"),
    );
  });
  it("bounds an unterminated frame", () => {
    const f = fixture();
    f.input.write("x".repeat(100001));
    expect(f.process.exit).toHaveBeenCalledWith(1);
  });
});
