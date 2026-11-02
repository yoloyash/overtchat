import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const platform = vi.hoisted(() => ({ OS: "android" }));
vi.mock("react-native", () => ({ Platform: platform }));

const names = ["Event", "EventTarget", "CustomEvent", "structuredClone", "TextEncoderStream", "TextDecoderStream"] as const;
const original = Object.fromEntries(names.map(name => [name, globalThis[name]]));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  platform.OS = "android";
});

async function loadWithoutGlobals() {
  for (const name of names) vi.stubGlobal(name, undefined);
  await import("./polyfills");
}

describe("native startup polyfills", () => {
  it("delivers actual SDK browser-emitter events, including once and removal", async () => {
    await loadWithoutGlobals();
    // Exercise the browser export selected by Metro, not the SDK's Node emitter.
    const require = createRequire(import.meta.url);
    const entry = join(dirname(require.resolve("@openai/agents-core")), "shims/shims-browser.mjs");
    const { BrowserEventEmitter } = await import(/* @vite-ignore */ pathToFileURL(entry).href);
    const emitter = new BrowserEventEmitter();
    const listener = vi.fn();
    const once = vi.fn();
    const audio = new Uint8Array([1, 2, 3]);
    emitter.on("audio", listener);
    emitter.once("audio", once);
    emitter.emit("audio", audio, "response-1");
    emitter.emit("audio", audio, "response-2");
    emitter.off("audio", listener);
    emitter.emit("audio", audio, "response-3");
    expect(listener.mock.calls).toEqual([[audio, "response-1"], [audio, "response-2"]]);
    expect(once.mock.calls).toEqual([[audio, "response-1"]]);
  });

  it("decodes streaming text across split UTF-8 characters", async () => {
    await loadWithoutGlobals();
    const bytes = new TextEncoder().encode('data: {"text":"hello 🚲"}\n\n');
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const reader = source.pipeThrough(new TextDecoderStream()).getReader();
    let result = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      result += value;
    }
    expect(result).toBe('data: {"text":"hello 🚲"}\n\n');
    const sourceValue = { parts: [{ text: "hello" }] };
    const copy = structuredClone(sourceValue);
    expect(copy).toEqual(sourceValue);
    expect(copy.parts).not.toBe(sourceValue.parts);
  });

  it("preserves runtime-provided globals", async () => {
    await import("./polyfills");
    for (const name of names) expect(globalThis[name]).toBe(original[name]);
  });

  it("leaves browser globals alone", async () => {
    platform.OS = "web";
    for (const name of names) vi.stubGlobal(name, undefined);
    await import("./polyfills");
    for (const name of names) expect(globalThis[name]).toBeUndefined();
  });
});
